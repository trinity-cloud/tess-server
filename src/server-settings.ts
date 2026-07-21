import {constants} from 'node:fs';
import {access, chmod, mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import type {ServerSettings} from './types.js';

export const defaultServerSettings: ServerSettings = Object.freeze<ServerSettings>({schema_version: 1, port: 8787, alias: 'local-llama-server', auth: {mode: 'off'}});

export function serverSettingsPath(): string {
  return process.env.TESS_SERVER_SETTINGS_PATH ?? join(homedir(), 'Library', 'Application Support', 'Trinity Cloud', 'Tess Server', 'settings.json');
}

export function validateServerSettings(value: unknown): ServerSettings {
  if (!value || typeof value !== 'object') throw new Error('server settings must be an object');
  const settings = value as Partial<ServerSettings>;
  if (settings.schema_version !== 1) throw new Error('unsupported server settings schema');
  if (!Number.isInteger(settings.port) || (settings.port ?? 0) < 1024 || (settings.port ?? 0) > 65535) throw new Error('server port must be between 1024 and 65535');
  if (typeof settings.alias !== 'string' || settings.alias.length < 1 || settings.alias.length > 128 || /[\u0000-\u001f\u007f]/u.test(settings.alias)) throw new Error('API model name must be 1–128 characters without control characters');
  if (!settings.auth || (settings.auth.mode !== 'off' && settings.auth.mode !== 'file')) throw new Error('authentication mode must be off or file');
  if (settings.auth.mode === 'file' && (typeof settings.auth.key_file !== 'string' || settings.auth.key_file.trim().length === 0)) throw new Error('bearer authentication requires a key file');
  return {
    schema_version: 1,
    port: settings.port!,
    alias: settings.alias,
    auth: settings.auth.mode === 'file' ? {mode: 'file', key_file: resolve(settings.auth.key_file!)} : {mode: 'off'},
  };
}

export async function loadServerSettings(path = serverSettingsPath()): Promise<ServerSettings> {
  try {
    return validateServerSettings(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(defaultServerSettings);
    throw error;
  }
}

export async function saveServerSettings(settings: ServerSettings, path = serverSettingsPath()): Promise<void> {
  const validated = validateServerSettings(settings);
  const directory = dirname(path);
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {mode: 0o600});
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function assertAuthKeyFile(settings: ServerSettings): Promise<void> {
  if (settings.auth.mode === 'off') return;
  const path = settings.auth.key_file!;
  const info = await stat(path);
  if (!info.isFile()) throw new Error('API key path must be a regular file');
  await access(path, constants.R_OK);
  const content = (await readFile(path, 'utf8')).trim();
  if (content.length < 32) throw new Error('API key file must contain at least 32 non-whitespace characters');
}

export async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', error => reject(new Error(`127.0.0.1:${port} is unavailable: ${error.message}`)));
    server.listen({host: '127.0.0.1', port, exclusive: true}, () => server.close(error => error ? reject(error) : resolvePromise()));
  });
}
