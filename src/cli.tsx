#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import React from 'react';
import {render} from 'ink';
import {parseCliArgs} from './args.js';
import {launchOverridesFromResolved, resolveProfileConfiguration} from './configuration.js';
import {candidateFromModelPath, defaultModelRoots, discoverModels, normalizeModelRoots} from './discovery.js';
import {engineSpec, profileById, runForeground, serveSpec, verifySpec} from './launch.js';
import {readPackageVersion, requireRuntimePayload, resolveProfileRoot} from './paths.js';
import {formatBytes, formatTokens, loadProfiles} from './profiles.js';
import {assertAuthKeyFile, assertPortAvailable, loadServerSettings, validateServerSettings} from './server-settings.js';
import type {ServerSettings} from './types.js';
import {App} from './ui/App.js';

const execFileAsync = promisify(execFile);

function printHelp(): void {
  console.log(`Tess Server

Usage:
  tess-server                                      Open the interactive model launcher
  tess-server models [--model-root PATH]           Discover profile-matched models
  tess-server profiles [--json]                    List packaged model profiles
  tess-server verify --profile ID --model PATH     Verify model identity without loading it
  tess-server serve --profile ID --model PATH      Start a verified profile in the foreground
  tess-server doctor [--json]                      Check the bundled engine and release payload
  tess-server engine -- <args...>                  Invoke the proprietary engine directly

Options:
  --model-root PATH   Add a folder to recursive model discovery (repeatable)
  --draft PATH        Separate draft model required by DSpark profiles
  --context TOKENS    Override the profile context (runtime becomes custom if different)
  --speculation MODE  DeepSeek profile mode: dspark or off
  --draft-depth N     DeepSeek DSpark draft depth (1–5)
  --p-min N           DeepSeek confidence threshold (0–1)
  --reasoning MODE    Model reasoning mode: full, low, or off
  --preserve-reasoning Preserve prior reasoning when the profile supports it
  --kv-quality MODE   Profile-declared KV quality choice
  --port PORT         Loopback API port (default 8787)
  --alias NAME        OpenAI model alias (default local-llama-server)
  --api-key-file PATH Require OpenAI bearer authentication from a file
  --no-auth           Disable saved bearer authentication for this session
  --print-config      Resolve and print configuration without loading a model
  --sidecar-root PATH Development override for an extracted release payload
  --json              Machine-readable output where supported
  --version           Print the npm package version
`);
}

async function main(): Promise<number> {
  const options = parseCliArgs(process.argv.slice(2));
  const version = await readPackageVersion();
  if (options.version) {
    console.log(version);
    return 0;
  }
  if (options.command === 'help') {
    printHelp();
    return 0;
  }

  const profileRoot = await resolveProfileRoot(options.sidecarRoot);
  const profiles = await loadProfiles(profileRoot);

  if (options.command === 'profiles') {
    if (options.json) {
      console.log(JSON.stringify(profiles, null, 2));
    } else {
      for (const profile of profiles) {
        const bytes = profile.shards.reduce((sum, shard) => sum + shard.bytes, 0);
        console.log(`${profile.profile_id}\t${profile.model.name}\t${formatBytes(bytes)}\t${formatTokens(profile.context.default)} context\t${profile.memory.ram_class_gib} GiB RAM`);
      }
    }
    return 0;
  }

  const roots = options.modelRoots.length > 0 ? await normalizeModelRoots(options.modelRoots) : await defaultModelRoots();
  if (options.command === 'models') {
    const candidates = await discoverModels(profiles, roots);
    if (options.json) {
      console.log(JSON.stringify(candidates, null, 2));
    } else if (candidates.length === 0) {
      console.log(`No profile-matched models found under: ${roots.join(', ') || '(no existing model roots)'}`);
    } else {
      for (const candidate of candidates) {
        console.log(`${candidate.complete ? 'ready' : 'incomplete'}\t${candidate.profile.profile_id}\t${candidate.modelPath}`);
        for (const issue of candidate.issues) {
          console.log(`  - ${issue}`);
        }
      }
    }
    return 0;
  }

  const payloadRoot = await requireRuntimePayload(options.sidecarRoot);
  if (options.command === 'doctor') {
    const binary = `${payloadRoot}/bin/tess-server`;
    const {stdout} = await execFileAsync(binary, ['--version-json']);
    const engine = JSON.parse(stdout) as Record<string, unknown>;
    const report = {
      ok: true,
      npm_package: '@trinity-cloud/tess-server',
      npm_version: version,
      host: `${process.platform} ${process.arch}`,
      node: process.version,
      payload_root: payloadRoot,
      engine,
      profiles: profiles.map(profile => profile.profile_id),
    };
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('Tess Server doctor: PASS');
      console.log(`npm: @trinity-cloud/tess-server ${version}`);
      console.log(`engine: ${String(engine.version)} (${String(engine.engine_commit)})`);
      console.log(`host: ${report.host} · Node ${process.version}`);
      console.log(`profiles: ${report.profiles.length}`);
    }
    return 0;
  }

  if (options.command === 'engine') {
    return runForeground(engineSpec(payloadRoot, options.engineArgs));
  }

  if (options.command === 'verify' || options.command === 'serve') {
    if (!options.profile || !options.model) {
      throw new Error(`${options.command} requires --profile and --model`);
    }
    const profile = profileById(profiles, options.profile);
    const candidate = await candidateFromModelPath(profile, options.model, options.draft);
    if (!candidate.complete) {
      throw new Error(`model set does not match profile ${profile.profile_id}: ${candidate.issues.join('; ')}`);
    }
    if (options.command === 'verify') {
      return runForeground(verifySpec(payloadRoot, candidate));
    }
    const saved = await loadServerSettings();
    const serverSettings: ServerSettings = validateServerSettings({
      ...saved,
      port: options.port ?? saved.port,
      alias: options.alias ?? saved.alias,
      auth: options.noAuth ? {mode: 'off'} : options.apiKeyFile ? {mode: 'file', key_file: options.apiKeyFile} : saved.auth,
    });
    const resolved = resolveProfileConfiguration(profile, {
      ...(options.context ? {context: options.context} : {}),
      ...(options.speculation ? {speculation: options.speculation} : {}),
      ...(options.draftDepth !== undefined ? {draftDepth: options.draftDepth} : {}),
      ...(options.pMin !== undefined ? {pMin: options.pMin} : {}),
      ...(options.reasoning ? {reasoning: options.reasoning} : {}),
      ...(options.preserveReasoning !== undefined ? {preserveReasoning: options.preserveReasoning} : {}),
      ...(options.kvQuality ? {kvQuality: options.kvQuality} : {}),
    });
    if (!resolved.startable) throw new Error(resolved.rejection ?? 'configuration is not startable');
    if (options.printConfig) {
      const output = {profile: profile.profile_id, runtime_label: resolved.runtimeLabel, resolved, server: {...serverSettings, auth: {mode: serverSettings.auth.mode, ...(serverSettings.auth.mode === 'file' ? {key_file: '[redacted path configured]'} : {})}}};
      console.log(options.json ? JSON.stringify(output, null, 2) : [
        `Profile: ${profile.profile_id}`,
        `Runtime: ${resolved.runtimeLabel}`,
        `Context: ${resolved.context.toLocaleString()} · batch/ubatch ${resolved.batch}/${resolved.ubatch}`,
        `Endpoint: http://127.0.0.1:${serverSettings.port}/v1 · model ${serverSettings.alias} · auth ${serverSettings.auth.mode === 'file' ? 'bearer' : 'off'}`,
        ...resolved.deltas.map(delta => `Delta: ${delta}`),
        ...resolved.warnings.map(warning => `Warning: ${warning}`),
      ].join('\n'));
      return 0;
    }
    await assertAuthKeyFile(serverSettings);
    await assertPortAvailable(serverSettings.port);
    return runForeground(serveSpec(payloadRoot, candidate, {
      ...launchOverridesFromResolved(resolved),
      port: serverSettings.port,
      alias: serverSettings.alias,
      ...(serverSettings.auth.mode === 'file' ? {apiKeyFile: serverSettings.auth.key_file} : {}),
    }));
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printHelp();
    return 2;
  }
  const savedServerSettings = await loadServerSettings();
  const initialServerSettings = validateServerSettings({
    ...savedServerSettings,
    port: options.port ?? savedServerSettings.port,
    alias: options.alias ?? savedServerSettings.alias,
    auth: options.noAuth ? {mode: 'off'} : options.apiKeyFile ? {mode: 'file', key_file: options.apiKeyFile} : savedServerSettings.auth,
  });
  const app = render(<App
    profiles={profiles}
    payloadRoot={payloadRoot}
    initialModelRoots={roots}
    initialServerSettings={initialServerSettings}
    {...(options.context ? {initialContext: options.context} : {})}
  />, {exitOnCtrlC: false});
  await app.waitUntilExit();
  return 0;
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(`tess-server: ${error instanceof Error ? error.message : String(error)}`);
  if (process.env.TESS_SERVER_DEBUG === '1' && error instanceof Error) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
