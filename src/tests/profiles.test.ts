import assert from 'node:assert/strict';
import test from 'node:test';
import {packageRoot, resolveProfileRoot} from '../paths.js';
import {launcherForProfile, loadProfiles} from '../profiles.js';

test('loads all six source profiles with launcher mappings', async () => {
  const root = await resolveProfileRoot(packageRoot);
  const profiles = await loadProfiles(root);
  assert.equal(profiles.length, 6);
  assert.deepEqual(new Set(profiles.map(profile => profile.profile_id)), new Set(['dsv4-dspark', 'hy3-iq2m', 'laguna-s21-q4km-dflash', 'minimax-m27-iq4xs', 'nemotron3-super-q4km', 'qwen36-a3b-q8-q4mtp']));
  for (const profile of profiles) {
    assert.match(launcherForProfile(profile.profile_id), /^serve-.+\.sh$/);
    assert.equal(profile.schema_version, 2);
    assert.ok(profile.expert.context_presets.some(preset => preset.tokens === profile.context.default));
  }
});
