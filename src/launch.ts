import {spawn, type ChildProcess} from 'node:child_process';
import {join} from 'node:path';
import {resolveUnprofiledConfiguration} from './configuration.js';
import {launcherForProfile} from './profiles.js';
import type {LaunchOverrides, ModelCandidate, ProcessSpec, ProfileDescriptor} from './types.js';

function launchEnvironment(payloadRoot: string, candidate: ModelCandidate, overrides: LaunchOverrides): NodeJS.ProcessEnv {
  const isMlxProfile = candidate.profile.model?.format === 'mlx' || candidate.profile.profile_id === 'dsv4-0731-mlx-24mixed';
  const supportsProfileSpeculation = !isMlxProfile;
  return {
    ...process.env,
    TESS_PACKAGE_ROOT: payloadRoot,
    MODEL: candidate.modelPath,
    ...(candidate.draftPath ? {DSPARK: candidate.draftPath, DRAFT_MODEL: candidate.draftPath} : {}),
    ...(overrides.context ? {CTX: String(overrides.context)} : {}),
    ...(overrides.port ? {PORT: String(overrides.port)} : {}),
    ...(overrides.alias ? {ALIAS: overrides.alias} : {}),
    ...(overrides.apiKeyFile ? {API_KEY_FILE: overrides.apiKeyFile} : {}),
    ...(supportsProfileSpeculation && overrides.speculation ? {DRAFT: overrides.speculation === 'dspark' ? '1' : '0'} : {}),
    ...(supportsProfileSpeculation && overrides.draftDepth !== undefined ? {DMAX: String(overrides.draftDepth)} : {}),
    ...(supportsProfileSpeculation && overrides.pMin !== undefined ? {PMIN: String(overrides.pMin)} : {}),
    ...(overrides.reasoning ? {REASONING: overrides.reasoning} : {}),
    ...(overrides.preserveReasoning !== undefined ? {PRESERVE_REASONING: overrides.preserveReasoning ? '1' : '0'} : {}),
    ...(overrides.kvQuality ? {KV_QUALITY: overrides.kvQuality} : {}),
    ...(overrides.printConfig ? {PRINT_CONFIG: '1'} : {}),
  };
}

export function serveSpec(payloadRoot: string, candidate: ModelCandidate, overrides: LaunchOverrides = {}): ProcessSpec {
  if (candidate.kind === 'unprofiled') {
    const resolved = resolveUnprofiledConfiguration(candidate, overrides);
    return {
      command: join(payloadRoot, 'bin', 'tess-server'),
      args: [
        ...(resolved.extraArgs ?? []),
        '-m', candidate.modelPath,
        '-c', String(resolved.context),
        '-b', String(resolved.batch),
        '-ub', String(resolved.ubatch),
        '-ctk', resolved.cacheTypeK ?? 'f16',
        '-ctv', resolved.cacheTypeV ?? 'f16',
        '-ngl', resolved.gpuLayers ?? 'all',
        '-fa', resolved.flashAttention ?? 'auto',
        '-np', String(resolved.slots ?? 1),
        resolved.mmap === false ? '--no-mmap' : '--mmap',
        ...(resolved.mlock ? ['--mlock'] : []),
        resolved.jinja === false ? '--no-jinja' : '--jinja',
        ...(resolved.chatTemplate ? ['--chat-template', resolved.chatTemplate] : []),
        '--reasoning', resolved.genericReasoning ?? 'auto',
        '--reasoning-format', resolved.reasoningFormat ?? 'auto',
        '--reasoning-budget', String(resolved.reasoningBudget ?? -1),
        ...(resolved.reasoningPreserve === 'on' ? ['--reasoning-preserve'] : resolved.reasoningPreserve === 'off' ? ['--no-reasoning-preserve'] : []),
        ...(resolved.mmproj ? ['-mm', resolved.mmproj] : ['--no-mmproj']),
        '--spec-type', resolved.speculationType ?? 'none',
        ...((resolved.speculationType ?? 'none') !== 'none' && resolved.draftModel ? ['-md', resolved.draftModel] : []),
        ...((resolved.speculationType ?? 'none') !== 'none' ? ['--spec-draft-n-max', String(resolved.draftDepth ?? 3), '--spec-draft-p-min', String(resolved.pMin ?? 0)] : []),
        '--metrics',
        '--slots',
        '--no-webui',
        '--no-ui-mcp-proxy',
        '--no-agent',
        '--alias', overrides.alias ?? 'local-llama-server',
        '--host', '127.0.0.1',
        '--port', String(overrides.port ?? 8787),
        ...(overrides.apiKeyFile ? ['--api-key-file', overrides.apiKeyFile] : []),
      ],
      cwd: payloadRoot,
      env: {...process.env},
    };
  }
  return {
    command: '/bin/bash',
    args: [join(payloadRoot, 'scripts', 'serve', launcherForProfile(candidate.profile.profile_id))],
    cwd: payloadRoot,
    env: launchEnvironment(payloadRoot, candidate, overrides),
  };
}

export function inspectSpec(payloadRoot: string, candidate: ModelCandidate): ProcessSpec {
  if (candidate.kind !== 'profiled') throw new Error('local GGUF models are inspected directly during discovery');
  return {
    command: '/bin/bash',
    args: [
      join(payloadRoot, 'scripts', 'inspect-model.sh'),
      candidate.profile.profile_id,
      candidate.modelPath,
      ...(candidate.draftPath ? [candidate.draftPath] : []),
    ],
    cwd: payloadRoot,
    env: {...process.env, TESS_PACKAGE_ROOT: payloadRoot},
  };
}

/** @deprecated Use inspectSpec. Kept for source compatibility with 0.1.x callers. */
export const verifySpec = inspectSpec;

export function engineSpec(payloadRoot: string, args: string[]): ProcessSpec {
  return {
    command: join(payloadRoot, 'bin', 'tess-server'),
    args,
    cwd: payloadRoot,
    env: {...process.env},
  };
}

export function spawnCaptured(spec: ProcessSpec): ChildProcess {
  return spawn(spec.command, spec.args, {cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
}

export function stopCaptured(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child if the process group already changed.
    }
  }
  child.kill(signal);
}

export async function runForeground(spec: ProcessSpec): Promise<number> {
  const child = spawn(spec.command, spec.args, {cwd: spec.cwd, env: spec.env, stdio: 'inherit'});
  const forwardSigint = (): void => { child.kill('SIGINT'); };
  const forwardSigterm = (): void => { child.kill('SIGTERM'); };
  process.once('SIGINT', forwardSigint);
  process.once('SIGTERM', forwardSigterm);
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', forwardSigint);
      process.removeListener('SIGTERM', forwardSigterm);
      resolvePromise(code ?? (signal ? 128 : 1));
    });
  });
}

export function profileById(profiles: ProfileDescriptor[], profileId: string): ProfileDescriptor {
  const profile = profiles.find(candidate => candidate.profile_id === profileId);
  if (!profile) {
    throw new Error(`unknown profile: ${profileId}`);
  }
  return profile;
}
