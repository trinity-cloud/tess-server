import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogForHost, embeddedCatalog} from '../catalog.js';
import {packageRoot} from '../paths.js';
import {loadProfiles} from '../profiles.js';

test('ships a pinned, offline, runtime-explicit featured catalog', async () => {
  const profiles = await loadProfiles(packageRoot);
  const catalog = embeddedCatalog(profiles);
  assert.equal(catalog.length, 5);
  assert.equal(catalog.filter(entry => entry.runtime === 'tess-mlx').length, 1);
  assert.equal(catalog.filter(entry => entry.runtime === 'gguf').length, 4);
  for (const entry of catalog) {
    assert.match(entry.revision, /^[0-9a-f]{40}$/u);
    assert.ok(entry.repository.includes('/'));
    assert.ok(entry.artifacts.length > 0);
    assert.equal(entry.diskBytes, entry.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0));
    assert.ok(entry.artifacts.every(artifact => artifact.bytes > 0 && artifact.sourcePath.length > 0));
  }
  assert.equal(catalog.find(entry => entry.runtime === 'tess-mlx')?.revision, '10001e0065f8394e03e968e652cbbe7cd2ca122c');
  const muse = catalog.find(entry => entry.id === 'muse-glimmer-30b-kquant-dflash');
  assert.equal(muse?.revision, 'b1f3e6ec2209678b3f29525bb9646286866f1675');
  assert.deepEqual(muse?.artifacts.map(artifact => artifact.sourcePath), [
    'muse-glimmer-30B-kquant-17gb.gguf',
    'dflash-kquant.gguf',
  ]);
  assert.equal(catalogForHost(catalog, 64).every(entry => entry.memoryClassGiB <= 65), true);
  assert.equal(catalogForHost(catalog, 128).length, 5);
});
