import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveProfileConfiguration} from '../configuration.js';
import {packageRoot} from '../paths.js';
import {loadProfiles} from '../profiles.js';

const profiles = await loadProfiles(packageRoot);
const profile = (id: string) => profiles.find(candidate => candidate.profile_id === id)!;

test('resolves every packaged default as verified', () => {
  for (const candidate of profiles) {
    const resolved = resolveProfileConfiguration(candidate);
    assert.equal(resolved.context, candidate.context.default);
    assert.equal(resolved.runtimeLabel, 'verified');
    assert.equal(resolved.startable, true);
  }
});

test('resolves context-owned ubatch policies', () => {
  assert.equal(resolveProfileConfiguration(profile('dsv4-dspark'), {context: 32768}).ubatch, 2048);
  assert.equal(resolveProfileConfiguration(profile('dsv4-dspark'), {context: 65536}).ubatch, 512);
  assert.equal(resolveProfileConfiguration(profile('hy3-iq2m'), {context: 32768}).ubatch, 8192);
  assert.equal(resolveProfileConfiguration(profile('hy3-iq2m'), {context: 49152}).ubatch, 512);
  assert.equal(resolveProfileConfiguration(profile('minimax-m27-iq4xs'), {context: 196608}).ubatch, 2048);
});

test('rejects non-presets and qualification-pending choices', () => {
  assert.throws(() => resolveProfileConfiguration(profile('hy3-iq2m'), {context: 24576}), /not available/);
  const deepSeek1m = resolveProfileConfiguration(profile('dsv4-dspark'), {context: 1048576});
  assert.equal(deepSeek1m.startable, false);
  assert.match(deepSeek1m.rejection ?? '', /512K|1M/);
  const balanced = resolveProfileConfiguration(profile('minimax-m27-iq4xs'), {kvQuality: 'balanced'});
  assert.equal(balanced.startable, false);
});

test('classifies allowlisted expert deltas as custom', () => {
  const resolved = resolveProfileConfiguration(profile('dsv4-dspark'), {speculation: 'off', draftDepth: 3, pMin: 0.8});
  assert.equal(resolved.runtimeLabel, 'custom');
  assert.deepEqual(resolved.deltas, ['speculation=off (verified dspark)', 'draft_depth=3 (verified 5)', 'p_min=0.8 (verified 0.65)']);
});
