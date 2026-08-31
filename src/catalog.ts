import {totalmem} from 'node:os';
import type {CatalogArtifact, CatalogEntry, ProfileDescriptor, RuntimeKind} from './types.js';

function runtimeForProfile(profile: ProfileDescriptor): RuntimeKind {
  return profile.model.format === 'mlx' ? 'tess-mlx' : 'gguf';
}

function artifacts(
  profile: ProfileDescriptor,
  sourcePath: (name: string, draft: boolean) => string,
): CatalogArtifact[] {
  return [
    ...profile.shards.map(item => ({name: item.name, bytes: item.bytes, sourcePath: sourcePath(item.name, false)})),
    ...(profile.draft ?? []).map(item => ({name: item.name, bytes: item.bytes, sourcePath: sourcePath(item.name, true)})),
  ];
}

function makeEntry(
  profiles: ProfileDescriptor[],
  definition: Omit<CatalogEntry, 'runtime' | 'diskBytes' | 'artifacts'> & {
    sourcePath: (name: string, draft: boolean) => string;
  },
): CatalogEntry | undefined {
  const profile = profiles.find(item => item.profile_id === definition.profileId);
  if (!profile) return undefined;
  const files = artifacts(profile, definition.sourcePath);
  const {sourcePath: _sourcePath, ...entry} = definition;
  return {
    ...entry,
    runtime: runtimeForProfile(profile),
    diskBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    artifacts: files,
  };
}

export function embeddedCatalog(profiles: ProfileDescriptor[]): CatalogEntry[] {
  const definitions: Array<Parameters<typeof makeEntry>[1]> = [
    {
      id: 'deepseek-v4-flash-0731-mlx-24mixed',
      profileId: 'dsv4-0731-mlx-24mixed',
      displayName: 'DeepSeek V4 Flash',
      description: 'Flagship Tess MLX model for 128 GiB Apple Silicon.',
      repository: 'mlx-community/DeepSeek-V4-Flash-0731-2.4bit-mixed',
      revision: '10001e0065f8394e03e968e652cbbe7cd2ca122c',
      licenseName: 'MIT',
      licenseUrl: 'https://huggingface.co/mlx-community/DeepSeek-V4-Flash-0731-2.4bit-mixed/blob/10001e0065f8394e03e968e652cbbe7cd2ca122c/README.md',
      memoryClassGiB: 128,
      destinationSlug: 'deepseek-v4-flash-0731-tess-mlx',
      featured: true,
      downloadEnabled: true,
      capabilities: ['tools', 'reasoning', 'target-only', '32K–1M context'],
      sourcePath: name => name,
    },
    {
      id: 'tess-4-35b-a3b-q8-mtp',
      profileId: 'qwen36-a3b-q8-q4mtp',
      displayName: 'Tess-4 35B A3B',
      description: 'Recommended fast general and agent model for 64 GiB Macs.',
      repository: 'migtissera/Tess-4-35B-A3B-GGUF',
      revision: '5591d8a2243a1d609dadfe5e11e3e6581a00947f',
      licenseName: 'Apache-2.0',
      licenseUrl: 'https://huggingface.co/migtissera/Tess-4-35B-A3B-GGUF/blob/5591d8a2243a1d609dadfe5e11e3e6581a00947f/README.md',
      memoryClassGiB: 64,
      destinationSlug: 'tess-4-35b-a3b',
      featured: true,
      downloadEnabled: true,
      capabilities: ['tools', 'reasoning', 'MTP', '32K–1M context'],
      sourcePath: name => name,
    },
  ];
  return definitions.map(definition => makeEntry(profiles, definition)).filter((entry): entry is CatalogEntry => Boolean(entry));
}

export function hostMemoryGiB(): number {
  return totalmem() / (1024 ** 3);
}

export function catalogForHost(entries: CatalogEntry[], memoryGiB = hostMemoryGiB()): CatalogEntry[] {
  return entries.filter(entry => entry.featured && entry.memoryClassGiB <= memoryGiB + 1);
}
