import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRawEngineArgs, resolveProfileConfiguration, resolveUnprofiledConfiguration} from '../configuration.js';
import {packageRoot} from '../paths.js';
import {loadProfiles} from '../profiles.js';
import type {ModelCandidate, ProfileDescriptor} from '../types.js';

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
  assert.equal(resolveProfileConfiguration(profile('laguna-s21-q4km-dflash'), {context: 32768}).ubatch, 2048);
  assert.equal(resolveProfileConfiguration(profile('minimax-m27-iq4xs'), {context: 196608}).ubatch, 2048);
  assert.equal(resolveProfileConfiguration(profile('dsv4-0731-dspark'), {context: 65536}).ubatch, 512);
});

test('keeps every configured context selectable and warns instead of blocking untested tiers', () => {
  assert.throws(() => resolveProfileConfiguration(profile('hy3-iq2m'), {context: 24576}), /not available/);
  for (const candidate of profiles) {
    for (const preset of candidate.expert.context_presets) {
      const resolved = resolveProfileConfiguration(candidate, {context: preset.tokens});
      assert.equal(resolved.startable, true, `${candidate.profile_id} ${preset.label} should remain selectable`);
      const qualified = preset.availability !== 'qualification-pending'
        && !preset.experimental
        && preset.tokens <= (candidate.context.qualified ?? candidate.context.default);
      if (!qualified) {
        if (candidate.context.presentation === 'plain') {
          assert.match(resolved.warnings.join('\n'), /consume more memory/, `${candidate.profile_id} ${preset.label} should warn about memory`);
        } else {
          assert.match(resolved.warnings.join('\n'), /Launch is allowed/, `${candidate.profile_id} ${preset.label} should warn`);
        }
      }
    }
  }
  const deepSeek1m = resolveProfileConfiguration(profile('dsv4-dspark'), {context: 1048576});
  assert.equal(deepSeek1m.startable, true);
  assert.equal(deepSeek1m.runtimeLabel, 'custom');
  assert.match(deepSeek1m.warnings.join('\n'), /has not been tested.*Launch is allowed/);
  const tess512k = resolveProfileConfiguration(profile('qwen36-a3b-q8-q4mtp'), {context: 524288});
  assert.equal(tess512k.startable, true);
  assert.equal(tess512k.runtimeLabel, 'verified');
  const tess1m = resolveProfileConfiguration(profile('qwen36-a3b-q8-q4mtp'), {context: 1010000});
  assert.equal(tess1m.startable, true);
  assert.equal(tess1m.runtimeLabel, 'custom');
  assert.match(tess1m.warnings.join('\n'), /has not been tested.*Launch is allowed/);
  const balanced = resolveProfileConfiguration(profile('minimax-m27-iq4xs'), {kvQuality: 'balanced'});
  assert.equal(balanced.startable, false);
  const laguna64k = resolveProfileConfiguration(profile('laguna-s21-q4km-dflash'), {context: 65536});
  assert.equal(laguna64k.startable, true);
  const laguna256k = resolveProfileConfiguration(profile('laguna-s21-q4km-dflash'), {context: 262144});
  assert.equal(laguna256k.startable, true);
  assert.equal(laguna256k.ubatch, 2048);
  assert.equal(laguna256k.runtimeLabel, 'verified');
  const dsv40731At16k = resolveProfileConfiguration(profile('dsv4-0731-dspark'), {context: 16384});
  assert.equal(dsv40731At16k.speculation, 'dspark');
  assert.equal(dsv40731At16k.runtimeLabel, 'custom');
  assert.match(dsv40731At16k.warnings.join('\n'), /token identity is not qualified/);
  const dsv40731At256k = resolveProfileConfiguration(profile('dsv4-0731-dspark'), {context: 262144});
  assert.equal(dsv40731At256k.speculation, 'dspark');
  assert.equal(dsv40731At256k.runtimeLabel, 'custom');
  const dsv40731OptOut = resolveProfileConfiguration(profile('dsv4-0731-dspark'), {context: 262144, speculation: 'off'});
  assert.equal(dsv40731OptOut.speculation, 'off');
  assert.equal(dsv40731OptOut.runtimeLabel, 'custom');
  const dsv40731Extended = resolveProfileConfiguration(profile('dsv4-0731-dspark'), {context: 524288});
  assert.equal(dsv40731Extended.speculation, 'dspark');
  assert.equal(dsv40731Extended.runtimeLabel, 'custom');
  const tessMlx1m = resolveProfileConfiguration(profile('dsv4-0731-mlx-24mixed'), {context: 1048576});
  assert.equal(tessMlx1m.startable, true);
  assert.equal(tessMlx1m.runtimeLabel, 'custom');
  assert.deepEqual(tessMlx1m.warnings, ['Larger contexts consume more memory and may not fit on every Mac.']);
  assert.throws(
    () => resolveProfileConfiguration(profile('dsv4-0731-mlx-24mixed'), {context: 16384}),
    /not available.*32,768.*1,048,576/,
  );
  const inkling32k = resolveProfileConfiguration(profile('inkling-small-iq3xxs'), {context: 32768});
  assert.equal(inkling32k.startable, true);
  assert.equal(inkling32k.runtimeLabel, 'custom');
  assert.match(inkling32k.warnings.join('\n'), /has not been qualified.*Launch is allowed/);
});

test('classifies allowlisted expert deltas as custom', () => {
  const resolved = resolveProfileConfiguration(profile('dsv4-dspark'), {speculation: 'off', draftDepth: 3, pMin: 0.8});
  assert.equal(resolved.runtimeLabel, 'custom');
  assert.deepEqual(resolved.deltas, ['speculation=off (verified dspark)', 'draft_depth=3 (verified 5)', 'p_min=0.8 (verified 0.65)']);
});

const genericProfile = {
  profile_id: 'unprofiled:/models/generic.gguf',
  context: {default: 4096},
  runtime: {batch: 512, ubatch: 512},
  expert: {context_presets: [{tokens: 4096, label: '4K', batch: 512, ubatch: 512}]},
} as ProfileDescriptor;

const genericCandidate: ModelCandidate = {
  kind: 'unprofiled', profile: genericProfile, modelPath: '/models/generic.gguf', complete: true, issues: [],
  companions: {
    mmproj: ['/models/mmproj-generic.gguf'], draft: ['/models/mtp-generic.gguf'],
    recommendedMmproj: '/models/mmproj-generic.gguf', recommendedDraft: '/models/mtp-generic.gguf', recommendedSpeculation: 'draft-mtp',
  },
};

test('resolves safe generic defaults and detected companions', () => {
  const resolved = resolveUnprofiledConfiguration(genericCandidate);
  assert.equal(resolved.runtimeLabel, 'unprofiled');
  assert.equal(resolved.context, 4096);
  assert.equal(resolved.batch, 512);
  assert.equal(resolved.ubatch, 512);
  assert.equal(resolved.cacheTypeK, 'f16');
  assert.equal(resolved.cacheTypeV, 'f16');
  assert.equal(resolved.gpuLayers, 'all');
  assert.equal(resolved.flashAttention, 'auto');
  assert.equal(resolved.slots, 1);
  assert.equal(resolved.mmap, true);
  assert.equal(resolved.mlock, false);
  assert.equal(resolved.jinja, true);
  assert.equal(resolved.mmproj, '/models/mmproj-generic.gguf');
  assert.equal(resolved.speculationType, 'draft-mtp');
  assert.equal(resolved.draftModel, '/models/mtp-generic.gguf');
  assert.equal(resolved.draftDepth, 3);
  assert.equal(resolved.pMin, 0);
});

test('accepts custom generic values and shell-style extra arguments', () => {
  const resolved = resolveUnprofiledConfiguration(genericCandidate, {
    context: 24576, batch: 1024, ubatch: 256, cacheTypeK: 'q8_0', cacheTypeV: 'q4_0', gpuLayers: '42',
    flashAttention: 'off', slots: 2, mmap: false, mlock: true, jinja: false, chatTemplate: 'chatml',
    genericReasoning: 'on', reasoningFormat: 'deepseek', reasoningBudget: 4096, reasoningPreserve: 'off',
    mmproj: '', speculationType: 'none', draftModel: '', rawEngineArgs: '--threads 12 --override-kv "foo=str:hello world"',
  });
  assert.equal(resolved.context, 24576);
  assert.equal(resolved.kvType, 'q8_0/q4_0');
  assert.equal(resolved.gpuLayers, '42');
  assert.equal(resolved.chatTemplate, 'chatml');
  assert.deepEqual(resolved.extraArgs, ['--threads', '12', '--override-kv', 'foo=str:hello world']);
});

test('rejects conflicting or invalid generic settings', () => {
  assert.throws(() => resolveUnprofiledConfiguration(genericCandidate, {batch: 256, ubatch: 512}), /ubatch/);
  assert.throws(() => resolveUnprofiledConfiguration(genericCandidate, {pMin: 1.1}), /acceptance threshold/);
  assert.throws(() => parseRawEngineArgs('--host 0.0.0.0'), /first-class/);
  assert.throws(() => parseRawEngineArgs('--ctx-size=8192'), /first-class/);
  assert.throws(() => parseRawEngineArgs('--tools all'), /first-class/);
  assert.throws(() => parseRawEngineArgs('--model-url https:\/\/example.test\/model.gguf'), /first-class/);
  assert.throws(() => parseRawEngineArgs('--threads "12'), /unclosed quote/);
});
