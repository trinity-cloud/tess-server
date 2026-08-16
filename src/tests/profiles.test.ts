import assert from 'node:assert/strict';
import test from 'node:test';
import {packageRoot, resolveProfileRoot} from '../paths.js';
import {launcherForProfile, loadProfiles} from '../profiles.js';

test('loads all ten source profiles with launcher mappings', async () => {
  const root = await resolveProfileRoot(packageRoot);
  const profiles = await loadProfiles(root);
  assert.equal(profiles.length, 10);
  assert.deepEqual(new Set(profiles.map(profile => profile.profile_id)), new Set([
    'dsv4-dspark',
    'dsv4-0731-dspark',
    'hy3-iq2m',
    'inkling-small-iq3xxs',
    'laguna-s21-q4km-dflash',
    'minimax-m27-iq4xs',
    'muse-glimmer-30b-kquant-dflash',
    'nemotron3-super-q4km',
    'qwen35-122b-a10b-q4km',
    'qwen36-a3b-q8-q4mtp',
  ]));
  for (const profile of profiles) {
    assert.match(launcherForProfile(profile.profile_id), /^serve-.+\.sh$/);
    assert.equal(profile.schema_version, 2);
    assert.equal(profile.engine.min_version, '0.1.4');
    assert.ok(profile.expert.context_presets.some(preset => preset.tokens === profile.context.default));
  }
  const laguna = profiles.find(profile => profile.profile_id === 'laguna-s21-q4km-dflash');
  assert.deepEqual(laguna?.shards, [{
    name: 'laguna-s-2.1-Q4_K_M.gguf',
    bytes: 68248759648,
    sha256: 'e163b2c98908809a71245d6bb68b2226994d9969cb2a438eccb72196a1c4147a',
  }]);
  assert.deepEqual(laguna?.draft, [{
    name: 'laguna-s-2.1-DFlash-BF16.gguf',
    bytes: 2233764224,
    sha256: '2ee8aa30338d6599bc7a8ce008cc57c56f2c2b2fdc21f6db9ecda203c751bfd4',
  }]);
  assert.equal(laguna?.context.qualified, 262144);
  assert.equal(laguna?.context.validated_prompt, 261856);
  assert.ok(laguna?.expert.context_presets.every(preset => preset.availability !== 'qualification-pending'));

  const tess = profiles.find(profile => profile.profile_id === 'qwen36-a3b-q8-q4mtp');
  assert.equal(tess?.context.qualified, 524288);
  assert.equal(tess?.context.validated_prompt, 524000);
  assert.equal(tess?.context.validated_generation, 256);
  assert.deepEqual(tess?.expert.context_presets.map(preset => preset.tokens), [32768, 65536, 131072, 262144, 524288, 1010000]);
  assert.equal(tess?.expert.context_presets.find(preset => preset.tokens === 524288)?.availability, undefined);
  assert.equal(tess?.expert.context_presets.find(preset => preset.tokens === 1010000)?.availability, 'qualification-pending');

  const qwen35 = profiles.find(profile => profile.profile_id === 'qwen35-122b-a10b-q4km');
  assert.equal(qwen35?.shards.length, 3);
  assert.equal(qwen35?.context.qualified, 16384);
  assert.equal(qwen35?.speculation, null);

  const inkling = profiles.find(profile => profile.profile_id === 'inkling-small-iq3xxs');
  assert.equal(inkling?.model.active_params, '12B');
  assert.equal(inkling?.runtime.env?.LLAMA_INKLING_SCONV_FUSED, 1);
  assert.equal(inkling?.memory.requires_wired_limit_mb, 129024);

  const muse = profiles.find(profile => profile.profile_id === 'muse-glimmer-30b-kquant-dflash');
  assert.equal(muse?.draft?.[0]?.name, 'dflash-kquant.gguf');
  assert.equal(muse?.speculation?.n_max, 3);
  assert.equal(muse?.speculation?.p_min, 0.7);

  const dsv40731 = profiles.find(profile => profile.profile_id === 'dsv4-0731-dspark');
  assert.equal(dsv40731?.draft?.[0]?.name, 'dspark-draft-0731.gguf');
  assert.equal(dsv40731?.context.default, 8192);
  assert.equal(dsv40731?.context.qualified, 262144);
  assert.equal(dsv40731?.expert.context_presets.find(preset => preset.tokens === 16384)?.speculation, 'off');
  assert.equal(dsv40731?.expert.context_presets.find(preset => preset.tokens === 262144)?.availability, undefined);
});
