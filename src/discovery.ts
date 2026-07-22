import {readdir, realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import type {ModelCandidate, ProfileContextPreset, ProfileDescriptor, ProfileShard} from './types.js';

const ignoredDirectories = new Set(['.git', '.Spotlight-V100', '.Trashes', 'Library', 'node_modules']);

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function normalizeModelRoots(roots: string[]): Promise<string[]> {
  const normalized = await Promise.all(roots.map(async root => {
    const expanded = resolve(expandHome(root));
    if (!(await isDirectory(expanded))) {
      return undefined;
    }
    try {
      return await realpath(expanded);
    } catch {
      return expanded;
    }
  }));
  return [...new Set(normalized.filter((root): root is string => Boolean(root)))];
}

export async function defaultModelRoots(): Promise<string[]> {
  const candidates = [join(homedir(), 'models'), join(homedir(), 'Models')];
  try {
    for (const volume of await readdir('/Volumes', {withFileTypes: true})) {
      if (!volume.isDirectory() || volume.name.startsWith('.')) {
        continue;
      }
      candidates.push(join('/Volumes', volume.name, 'models'));
      candidates.push(join('/Volumes', volume.name, 'Models'));
    }
  } catch {
    // /Volumes is macOS-specific and may not exist in source-only test environments.
  }
  return normalizeModelRoots(candidates);
}

async function walkForGguf(root: string, maxDepth: number): Promise<string[]> {
  const matches: string[] = [];
  const pending: Array<{path: string; depth: number}> = [{path: root, depth: 0}];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      break;
    }
    let entries;
    try {
      entries = await readdir(current.path, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith('.gguf')) {
        try {
          if ((await stat(path)).isFile()) {
            matches.push(path);
          }
        } catch {
          // Ignore broken or unreadable links.
        }
      } else if (entry.isDirectory() && current.depth < maxDepth && !ignoredDirectories.has(entry.name)) {
        pending.push({path, depth: current.depth + 1});
      }
    }
  }
  return matches;
}

async function inspectCollection(directory: string, shards: ProfileShard[], issues: string[]): Promise<void> {
  for (const shard of shards) {
    const path = join(directory, shard.name);
    try {
      const info = await stat(path);
      if (!info.isFile()) {
        issues.push(`${shard.name} is not a regular file`);
      } else if (info.size !== shard.bytes) {
        issues.push(`${shard.name} has ${info.size} bytes; expected ${shard.bytes}`);
      }
    } catch {
      issues.push(`missing ${shard.name}`);
    }
  }
}

export async function candidateFromModelPath(profile: ProfileDescriptor, modelPath: string, explicitDraftPath?: string): Promise<ModelCandidate> {
  const resolved = resolve(expandHome(modelPath));
  const directory = resolve(resolved, '..');
  const issues: string[] = [];
  if (basename(resolved) !== profile.shards[0]?.name) {
    issues.push(`expected first shard ${profile.shards[0]?.name}`);
  }
  await inspectCollection(directory, profile.shards, issues);
  let draftPath: string | undefined;
  if (profile.draft?.[0]) {
    draftPath = explicitDraftPath ? resolve(expandHome(explicitDraftPath)) : join(directory, profile.draft[0].name);
    if (basename(draftPath) !== profile.draft[0].name) {
      issues.push(`expected first draft shard ${profile.draft[0].name}`);
    }
    await inspectCollection(resolve(draftPath, '..'), profile.draft, issues);
  }
  return {
    kind: 'profiled',
    profile,
    modelPath: resolved,
    ...(draftPath ? {draftPath} : {}),
    complete: issues.length === 0,
    issues,
  };
}

const genericContextPresets: ProfileContextPreset[] = [4096, 8192, 16384, 32768, 65536, 131072].map(tokens => ({
  tokens,
  label: tokens >= 1024 ? `${tokens / 1024}K` : String(tokens),
  recommended: tokens === 4096,
  ubatch: 512,
  batch: 512,
}));

function genericModelName(path: string): string {
  return basename(path).replace(/-00001-of-\d{5}(?=\.gguf$)/i, '').replace(/\.gguf$/i, '');
}

function isGenericPrimaryModel(path: string): boolean {
  const name = basename(path);
  return !/^(?:mmproj|mtp)-/i.test(name) && !/(?:^|[-_.])draft-head(?:[-_.]|$)/i.test(name);
}

function companionKind(path: string): 'mmproj' | 'draft' | undefined {
  const name = basename(path);
  if (/^mmproj-/i.test(name)) return 'mmproj';
  if (/^mtp-/i.test(name) || /(?:^|[-_.])draft-head(?:[-_.]|$)/i.test(name)) return 'draft';
  return undefined;
}

function normalizedArtifactStem(path: string): string {
  return genericModelName(path).replace(/^(?:mmproj|mtp)-/i, '').toLowerCase();
}

function modelFamily(stem: string): string {
  return stem
    .replace(/-(?:base|instruct|chat)$/i, '')
    .replace(/-(?:[ui]?q\d(?:_[a-z0-9]+)*|f16|f32|bf16)$/i, '');
}

function companionScore(modelPath: string, companionPath: string): number {
  const primary = normalizedArtifactStem(modelPath);
  const companion = normalizedArtifactStem(companionPath);
  if (companion === primary) return 100;
  const primaryFamily = modelFamily(primary);
  const companionFamily = modelFamily(companion);
  if (primaryFamily === companionFamily) return 80;
  if (companion.includes(primaryFamily) || primary.includes(companionFamily)) return 40;
  return 0;
}

async function genericCandidateFromModelPath(modelPath: string, allPaths: string[]): Promise<ModelCandidate | undefined> {
  const name = basename(modelPath);
  const shardMatch = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i.exec(name);
  if (shardMatch && shardMatch[2] !== '00001') return undefined;

  const directory = resolve(modelPath, '..');
  const shards: ProfileShard[] = [];
  const issues: string[] = [];
  const shardCount = shardMatch ? Number(shardMatch[3]) : 1;
  for (let index = 1; index <= shardCount; index += 1) {
    const shardName = shardMatch ? `${shardMatch[1]}-${String(index).padStart(5, '0')}-of-${shardMatch[3]}.gguf` : name;
    try {
      const info = await stat(join(directory, shardName));
      if (!info.isFile()) issues.push(`${shardName} is not a regular file`);
      else shards.push({name: shardName, bytes: info.size, sha256: ''});
    } catch {
      issues.push(`missing ${shardName}`);
    }
  }
  const bytes = shards.reduce((sum, shard) => sum + shard.bytes, 0);
  const modelName = genericModelName(modelPath);
  const nearbyCompanions = allPaths.filter(path => resolve(path, '..') === directory && path !== modelPath && companionKind(path));
  const mmproj = nearbyCompanions.filter(path => companionKind(path) === 'mmproj').sort((left, right) => companionScore(modelPath, right) - companionScore(modelPath, left) || left.localeCompare(right));
  const draft = nearbyCompanions.filter(path => companionKind(path) === 'draft').sort((left, right) => companionScore(modelPath, right) - companionScore(modelPath, left) || left.localeCompare(right));
  const recommendedMmproj = mmproj.find(path => companionScore(modelPath, path) >= 80);
  const recommendedDraft = draft.find(path => companionScore(modelPath, path) >= 80);
  const profile: ProfileDescriptor = {
    profile_id: `unprofiled:${modelPath}`,
    schema_version: 2,
    engine: {min_version: '0.1.0', max_version: null},
    model: {name: modelName, architecture: 'unknown', quant_label: 'Generic GGUF', total_params: 'unknown', active_params: null},
    shards,
    draft: null,
    context: {trained: 0, engine_allocatable: 131072, validated: 0, default: 4096},
    runtime: {batch: 512, ubatch: 512, kv_type: 'f16', slots: 1, flash_attention: true, jinja: true},
    speculation: null,
    memory: {ram_class_gib: 0, wired_limit_note: null},
    evidence: [],
    limitations: [
      'No Tess profile matches this file; this launch is best-effort and carries no verification claim.',
      'Architecture compatibility, trained context, memory requirements, and performance have not been qualified.',
    ],
    expert: {context_presets: genericContextPresets},
  };
  return {
    kind: 'unprofiled',
    profile,
    modelPath,
    companions: {
      mmproj,
      draft,
      ...(recommendedMmproj ? {recommendedMmproj} : {}),
      ...(recommendedDraft ? {recommendedDraft, recommendedSpeculation: /^mtp-/i.test(basename(recommendedDraft)) ? 'draft-mtp' : 'draft-simple'} : {}),
    },
    complete: issues.length === 0 && bytes > 0,
    issues,
  };
}

export async function discoverModels(profiles: ProfileDescriptor[], roots: string[], maxDepth = 6): Promise<ModelCandidate[]> {
  const normalizedRoots = await normalizeModelRoots(roots);
  const paths = (await Promise.all(normalizedRoots.map(async root => walkForGguf(root, maxDepth)))).flat();
  const uniquePaths = [...new Set(await Promise.all(paths.map(async path => {
    try {
      return await realpath(path);
    } catch {
      return resolve(path);
    }
  })))];
  const pathsByName = new Map<string, string[]>();
  for (const path of uniquePaths) {
    const name = basename(path);
    pathsByName.set(name, [...(pathsByName.get(name) ?? []), path]);
  }
  const profileByName = new Map(profiles.map(profile => [profile.shards[0]?.name, profile]));
  const modelPaths = uniquePaths.filter(path => profileByName.has(basename(path)));
  const profiledCandidates = await Promise.all(modelPaths.map(async path => {
    const profile = profileByName.get(basename(path));
    if (!profile) {
      return undefined;
    }
    const draftName = profile.draft?.[0]?.name;
    const draftPaths = draftName ? pathsByName.get(draftName) ?? [] : [];
    const sameDirectoryDraft = draftPaths.find(draftPath => resolve(draftPath, '..') === resolve(path, '..'));
    const explicitDraft = sameDirectoryDraft ?? draftPaths[0];
    return candidateFromModelPath(profile, path, explicitDraft);
  }));
  const knownProfileFiles = new Set(profiles.flatMap(profile => [...profile.shards, ...(profile.draft ?? [])].map(shard => shard.name)));
  const genericCandidates = await Promise.all(uniquePaths.filter(path => !knownProfileFiles.has(basename(path)) && isGenericPrimaryModel(path)).map(path => genericCandidateFromModelPath(path, uniquePaths)));
  return [...profiledCandidates, ...genericCandidates].filter((candidate): candidate is ModelCandidate => Boolean(candidate)).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'profiled' ? -1 : 1;
    const byModel = left.profile.model.name.localeCompare(right.profile.model.name);
    return byModel === 0 ? left.modelPath.localeCompare(right.modelPath) : byModel;
  });
}
