import {spawn, type ChildProcess} from 'node:child_process';
import {join} from 'node:path';
import {launcherForProfile} from './profiles.js';
import type {LaunchOverrides, ModelCandidate, ProcessSpec, ProfileDescriptor} from './types.js';

function launchEnvironment(payloadRoot: string, candidate: ModelCandidate, overrides: LaunchOverrides): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TESS_PACKAGE_ROOT: payloadRoot,
    MODEL: candidate.modelPath,
    ...(candidate.draftPath ? {DSPARK: candidate.draftPath} : {}),
    ...(overrides.context ? {CTX: String(overrides.context)} : {}),
    ...(overrides.port ? {PORT: String(overrides.port)} : {}),
    ...(overrides.alias ? {ALIAS: overrides.alias} : {}),
    ...(overrides.apiKeyFile ? {API_KEY_FILE: overrides.apiKeyFile} : {}),
    ...(overrides.speculation ? {DRAFT: overrides.speculation === 'dspark' ? '1' : '0'} : {}),
    ...(overrides.draftDepth !== undefined ? {DMAX: String(overrides.draftDepth)} : {}),
    ...(overrides.pMin !== undefined ? {PMIN: String(overrides.pMin)} : {}),
    ...(overrides.reasoning ? {REASONING: overrides.reasoning} : {}),
    ...(overrides.preserveReasoning !== undefined ? {PRESERVE_REASONING: overrides.preserveReasoning ? '1' : '0'} : {}),
    ...(overrides.kvQuality ? {KV_QUALITY: overrides.kvQuality} : {}),
    ...(overrides.printConfig ? {PRINT_CONFIG: '1'} : {}),
  };
}

export function serveSpec(payloadRoot: string, candidate: ModelCandidate, overrides: LaunchOverrides = {}): ProcessSpec {
  return {
    command: '/bin/bash',
    args: [join(payloadRoot, 'scripts', 'serve', launcherForProfile(candidate.profile.profile_id))],
    cwd: payloadRoot,
    env: launchEnvironment(payloadRoot, candidate, overrides),
  };
}

export function verifySpec(payloadRoot: string, candidate: ModelCandidate): ProcessSpec {
  return {
    command: '/bin/bash',
    args: [
      join(payloadRoot, 'scripts', 'verify-profile.sh'),
      candidate.profile.profile_id,
      candidate.modelPath,
      ...(candidate.draftPath ? [candidate.draftPath] : []),
    ],
    cwd: payloadRoot,
    env: {...process.env, TESS_PACKAGE_ROOT: payloadRoot},
  };
}

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
