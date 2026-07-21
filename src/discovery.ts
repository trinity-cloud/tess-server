import {readdir, realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import type {ModelCandidate, ProfileDescriptor, ProfileShard} from './types.js';

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

function discoveryNames(profiles: ProfileDescriptor[]): Set<string> {
  return new Set(profiles.flatMap(profile => [profile.shards[0]?.name, profile.draft?.[0]?.name]).filter((name): name is string => Boolean(name)));
}

async function walkForNames(root: string, names: Set<string>, maxDepth: number): Promise<string[]> {
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
      if ((entry.isFile() || entry.isSymbolicLink()) && names.has(entry.name)) {
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
    profile,
    modelPath: resolved,
    ...(draftPath ? {draftPath} : {}),
    complete: issues.length === 0,
    issues,
  };
}

export async function discoverModels(profiles: ProfileDescriptor[], roots: string[], maxDepth = 6): Promise<ModelCandidate[]> {
  const normalizedRoots = await normalizeModelRoots(roots);
  const names = discoveryNames(profiles);
  const paths = (await Promise.all(normalizedRoots.map(async root => walkForNames(root, names, maxDepth)))).flat();
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
  const candidates = await Promise.all(modelPaths.map(async path => {
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
  return candidates.filter((candidate): candidate is ModelCandidate => Boolean(candidate)).sort((left, right) => {
    const byModel = left.profile.model.name.localeCompare(right.profile.model.name);
    return byModel === 0 ? left.modelPath.localeCompare(right.modelPath) : byModel;
  });
}
