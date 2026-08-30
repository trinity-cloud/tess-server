import {randomUUID} from 'node:crypto';
import {chmod, mkdir, readFile, realpath, rename, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import type {CatalogEntry, LocalModelEntry, ModelCandidate, ModelLibrary, RuntimeKind} from './types.js';

export const emptyLibrary: ModelLibrary = Object.freeze({schemaVersion: 1, entries: []});

export function modelLibraryPath(): string {
  return process.env.TESS_SERVER_LIBRARY_PATH ?? join(
    homedir(), 'Library', 'Application Support', 'Trinity Cloud',
    'Tess Server', 'model-library.json',
  );
}

function runtimeForCandidate(candidate: ModelCandidate): RuntimeKind {
  return candidate.profile.model.format === 'mlx' ? 'tess-mlx' : 'gguf';
}

function validateEntry(value: unknown): LocalModelEntry {
  if (!value || typeof value !== 'object') throw new Error('library entry must be an object');
  const entry = value as Partial<LocalModelEntry>;
  if (typeof entry.id !== 'string' || entry.id.length === 0) throw new Error('library entry ID is invalid');
  if (entry.runtime !== 'tess-mlx' && entry.runtime !== 'gguf') throw new Error('library runtime is invalid');
  if (typeof entry.displayName !== 'string' || entry.displayName.length === 0) throw new Error('library display name is invalid');
  if (typeof entry.path !== 'string' || entry.path.length === 0) throw new Error('library path is invalid');
  if (!Array.isArray(entry.artifactNames) || !entry.artifactNames.every(item => typeof item === 'string')) throw new Error('library artifact names are invalid');
  if (!Array.isArray(entry.artifactBytes) || !entry.artifactBytes.every(item => Number.isSafeInteger(item) && item >= 0)) throw new Error('library artifact sizes are invalid');
  if (entry.artifactNames.length !== entry.artifactBytes.length) throw new Error('library artifact inventory is inconsistent');
  if (typeof entry.lastInspectedAt !== 'string' || typeof entry.lastKnownReady !== 'boolean' || typeof entry.favorite !== 'boolean') throw new Error('library state is invalid');
  return {
    id: entry.id,
    runtime: entry.runtime,
    ...(typeof entry.catalogId === 'string' ? {catalogId: entry.catalogId} : {}),
    ...(typeof entry.profileId === 'string' ? {profileId: entry.profileId} : {}),
    displayName: entry.displayName,
    path: resolve(entry.path),
    artifactNames: [...entry.artifactNames],
    artifactBytes: [...entry.artifactBytes],
    lastInspectedAt: entry.lastInspectedAt,
    lastKnownReady: entry.lastKnownReady,
    favorite: entry.favorite,
    ...(entry.provenance && typeof entry.provenance.repository === 'string' &&
        typeof entry.provenance.revision === 'string' &&
        typeof entry.provenance.completedAt === 'string'
      ? {provenance: {...entry.provenance}}
      : {}),
  };
}

export function validateLibrary(value: unknown): ModelLibrary {
  if (!value || typeof value !== 'object') throw new Error('model library must be an object');
  const input = value as {schemaVersion?: unknown; entries?: unknown};
  // The pre-release prototype stored only {entries}; migrate it without
  // dropping external-volume records.
  const schemaVersion = input.schemaVersion ?? 1;
  if (schemaVersion !== 1 || !Array.isArray(input.entries)) throw new Error('unsupported model library schema');
  const entries = input.entries.map(validateEntry);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error('model library contains duplicate IDs');
    ids.add(entry.id);
  }
  return {schemaVersion: 1, entries};
}

export async function loadModelLibrary(path = modelLibraryPath()): Promise<ModelLibrary> {
  try {
    return validateLibrary(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(emptyLibrary);
    throw error;
  }
}

export async function saveModelLibrary(library: ModelLibrary, path = modelLibraryPath()): Promise<void> {
  const validated = validateLibrary(library);
  const directory = dirname(path);
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {mode: 0o600});
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function canonicalOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export async function entryFromCandidate(
  candidate: ModelCandidate,
  catalog?: CatalogEntry,
): Promise<LocalModelEntry> {
  const path = await canonicalOrResolved(candidate.modelPath);
  const artifacts = candidate.profile.shards;
  return {
    id: randomUUID(),
    runtime: runtimeForCandidate(candidate),
    ...(catalog ? {catalogId: catalog.id} : {}),
    ...(candidate.kind === 'profiled' ? {profileId: candidate.profile.profile_id} : {}),
    displayName: catalog?.displayName ?? candidate.profile.model.name,
    path,
    artifactNames: artifacts.map(item => item.name),
    artifactBytes: artifacts.map(item => item.bytes),
    lastInspectedAt: new Date().toISOString(),
    lastKnownReady: candidate.complete,
    favorite: false,
    ...(catalog ? {provenance: {
      repository: catalog.repository,
      revision: catalog.revision,
      completedAt: new Date().toISOString(),
    }} : {}),
  };
}

export function upsertLibraryEntry(library: ModelLibrary, entry: LocalModelEntry): ModelLibrary {
  const existing = library.entries.find(item =>
    item.runtime === entry.runtime && resolve(item.path) === resolve(entry.path));
  const next = existing
    ? library.entries.map(item => item.id === existing.id ? {...entry, id: existing.id, favorite: existing.favorite} : item)
    : [...library.entries, entry];
  return {schemaVersion: 1, entries: next};
}

export function removeLibraryEntry(library: ModelLibrary, id: string): ModelLibrary {
  return {schemaVersion: 1, entries: library.entries.filter(entry => entry.id !== id)};
}
