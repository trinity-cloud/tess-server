import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ProfileDescriptor} from './types.js';

const launcherByProfile: Readonly<Record<string, string>> = Object.freeze({
  'dsv4-dspark': 'serve-dsv4.sh',
  'dsv4-0731-dspark': 'serve-dsv4-0731.sh',
  'dsv4-0731-mlx-24mixed': 'serve-dsv4-0731-mlx.sh',
  'hy3-iq2m': 'serve-hy3.sh',
  'inkling-small-iq3xxs': 'serve-inkling.sh',
  'laguna-s21-q4km-dflash': 'serve-laguna.sh',
  'minimax-m27-iq4xs': 'serve-minimax.sh',
  'muse-glimmer-30b-kquant-dflash': 'serve-muse.sh',
  'nemotron3-super-q4km': 'serve-nemotron3.sh',
  'qwen35-122b-a10b-q4km': 'serve-qwen35-122b.sh',
  'qwen36-a3b-q8-q4mtp': 'serve-qwen36.sh',
});

function assertProfile(value: unknown, file: string): asserts value is ProfileDescriptor {
  if (!value || typeof value !== 'object') {
    throw new Error(`invalid profile JSON: ${file}`);
  }
  const profile = value as Partial<ProfileDescriptor>;
  if (profile.schema_version !== 2 || typeof profile.profile_id !== 'string') {
    throw new Error(`unsupported profile schema: ${file}`);
  }
  if (!profile.model || typeof profile.model.name !== 'string' || !profile.context || !profile.memory) {
    throw new Error(`incomplete profile descriptor: ${file}`);
  }
  if (!Array.isArray(profile.shards) || profile.shards.length === 0) {
    throw new Error(`profile has no model shards: ${file}`);
  }
  if (!launcherByProfile[profile.profile_id]) {
    throw new Error(`profile has no packaged launcher mapping: ${profile.profile_id}`);
  }
  if (!profile.expert || !Array.isArray(profile.expert.context_presets) || profile.expert.context_presets.length === 0) {
    throw new Error(`profile has no expert context presets: ${file}`);
  }
  const contexts = new Set<number>();
  for (const preset of profile.expert.context_presets) {
    if (!Number.isSafeInteger(preset.tokens) || preset.tokens <= 0 || !Number.isSafeInteger(preset.ubatch) || preset.ubatch <= 0) {
      throw new Error(`profile has an invalid context preset: ${file}`);
    }
    if (contexts.has(preset.tokens)) throw new Error(`profile has a duplicate context preset: ${file}`);
    contexts.add(preset.tokens);
  }
  if (!contexts.has(profile.context.default)) throw new Error(`profile default is not a context preset: ${file}`);
}

export async function loadProfiles(profileRoot: string): Promise<ProfileDescriptor[]> {
  const directory = join(profileRoot, 'profiles');
  const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
  const profiles = await Promise.all(files.map(async file => {
    const raw = await readFile(join(directory, file), 'utf8');
    const value: unknown = JSON.parse(raw);
    assertProfile(value, file);
    if (`${value.profile_id}.json` !== file) {
      throw new Error(`profile ID does not match filename: ${file}`);
    }
    return value;
  }));
  return profiles.sort((left, right) => left.model.name.localeCompare(right.model.name));
}

export function launcherForProfile(profileId: string): string {
  const launcher = launcherByProfile[profileId];
  if (!launcher) {
    throw new Error(`no launcher is registered for profile: ${profileId}`);
  }
  return launcher;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1024) {
    const value = tokens / 1024;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}k`;
  }
  return String(tokens);
}
