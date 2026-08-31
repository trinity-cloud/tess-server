import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogForHost, embeddedCatalog} from '../catalog.js';
import {packageRoot} from '../paths.js';
import {loadProfiles} from '../profiles.js';

test('ships exactly the two pinned product models', async () => {
  const profiles = await loadProfiles(packageRoot);
  const catalog = embeddedCatalog(profiles);
  assert.equal(catalog.length, 2);
  assert.equal(catalog.filter(entry => entry.runtime === 'tess-mlx').length, 1);
  assert.equal(catalog.filter(entry => entry.runtime === 'gguf').length, 1);
  for (const entry of catalog) {
    assert.match(entry.revision, /^[0-9a-f]{40}$/u);
    assert.ok(entry.repository.includes('/'));
    assert.ok(entry.artifacts.length > 0);
    assert.equal(entry.diskBytes, entry.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0));
    assert.ok(entry.artifacts.every(artifact => artifact.bytes > 0 && artifact.sourcePath.length > 0));
  }
  assert.equal(catalog.find(entry => entry.runtime === 'tess-mlx')?.revision, '10001e0065f8394e03e968e652cbbe7cd2ca122c');
  assert.deepEqual(catalog.map(entry => entry.displayName), ['DeepSeek V4 Flash', 'Tess-4 35B A3B']);
  assert.equal(catalogForHost(catalog, 64).every(entry => entry.memoryClassGiB <= 65), true);
  assert.equal(catalogForHost(catalog, 128).length, 2);
});
