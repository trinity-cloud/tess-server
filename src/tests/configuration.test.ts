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
});

test('rejects non-presets and qualification-pending choices', () => {
  assert.throws(() => resolveProfileConfiguration(profile('hy3-iq2m'), {context: 24576}), /not available/);
  const deepSeek1m = resolveProfileConfiguration(profile('dsv4-dspark'), {context: 1048576});
  assert.equal(deepSeek1m.startable, false);
  assert.match(deepSeek1m.rejection ?? '', /512K|1M/);
  const balanced = resolveProfileConfiguration(profile('minimax-m27-iq4xs'), {kvQuality: 'balanced'});
  assert.equal(balanced.startable, false);
  const laguna64k = resolveProfileConfiguration(profile('laguna-s21-q4km-dflash'), {context: 65536});
  assert.equal(laguna64k.startable, false);
  assert.match(laguna64k.rejection ?? '', /64K/);
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
