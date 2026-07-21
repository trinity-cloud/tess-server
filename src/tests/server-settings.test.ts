import assert from 'node:assert/strict';
import {chmod, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertAuthKeyFile, defaultServerSettings, loadServerSettings, saveServerSettings, validateServerSettings} from '../server-settings.js';

test('validates defaults and rejects unsafe fields', () => {
  assert.deepEqual(validateServerSettings(defaultServerSettings), defaultServerSettings);
  assert.throws(() => validateServerSettings({...defaultServerSettings, port: 80}), /1024/);
  assert.throws(() => validateServerSettings({...defaultServerSettings, alias: 'bad\nname'}), /control/);
});

test('persists settings atomically with private permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-settings-test.'));
  try {
    const path = join(root, 'nested', 'settings.json');
    const settings = {...defaultServerSettings, port: 9000, alias: 'tess-local'};
    await saveServerSettings(settings, path);
    assert.deepEqual(await loadServerSettings(path), settings);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.match(await readFile(path, 'utf8'), /tess-local/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('checks file-backed bearer material without returning the secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-key-test.'));
  try {
    const key = join(root, 'api.key');
    await writeFile(key, 'a'.repeat(48), {mode: 0o600});
    await chmod(key, 0o600);
    const settings = validateServerSettings({...defaultServerSettings, auth: {mode: 'file', key_file: key}});
    await assertAuthKeyFile(settings);
    await writeFile(key, 'short', {mode: 0o600});
    await assert.rejects(() => assertAuthKeyFile(settings), /at least 32/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
