import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadModelLibrary, removeLibraryEntry, saveModelLibrary, upsertLibraryEntry, validateLibrary} from '../library.js';
import type {LocalModelEntry, ModelLibrary} from '../types.js';

function entry(id: string, path: string): LocalModelEntry {
  return {
    id, runtime: 'gguf', displayName: 'Local model', path,
    artifactNames: ['model.gguf'], artifactBytes: [12],
    lastInspectedAt: '2026-08-30T00:00:00.000Z', lastKnownReady: true, favorite: false,
  };
}

test('migrates and persists the model library atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-library-test.'));
  try {
    const path = join(root, 'state', 'models.json');
    const migrated = validateLibrary({entries: [entry('one', '/Volumes/Offline/model.gguf')]});
    assert.equal(migrated.schemaVersion, 1);
    await saveModelLibrary(migrated, path);
    assert.deepEqual(await loadModelLibrary(path), migrated);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path, 'utf8')).includes('sha256'), false);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('deduplicates paths and removes only library records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-library-remove-test.'));
  try {
    const model = join(root, 'keep me.gguf');
    await writeFile(model, 'model-bytes!');
    let library: ModelLibrary = {schemaVersion: 1, entries: [entry('one', model)]};
    library = upsertLibraryEntry(library, {...entry('two', model), displayName: 'Renamed'});
    assert.equal(library.entries.length, 1);
    assert.equal(library.entries[0]?.id, 'one');
    library = removeLibraryEntry(library, 'one');
    assert.equal(library.entries.length, 0);
    assert.equal((await stat(model)).isFile(), true);
  } finally { await rm(root, {recursive: true, force: true}); }
});
