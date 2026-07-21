import assert from 'node:assert/strict';
import {mkdtemp, mkdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {discoverModels} from '../discovery.js';
import type {ProfileDescriptor} from '../types.js';

const fixtureProfile: ProfileDescriptor = {
  profile_id: 'fixture', schema_version: 2,
  engine: {min_version: '0.1.0', max_version: null},
  model: {name: 'Fixture Model', architecture: 'fixture', quant_label: 'Q4', total_params: '1B', active_params: '1B'},
  shards: [{name: 'fixture.gguf', bytes: 6, sha256: '0'.repeat(64)}], draft: null,
  context: {trained: 4096, engine_allocatable: 4096, validated: 2048, default: 2048},
  runtime: {batch: 1, ubatch: 1, kv_type: 'f16', slots: 1, flash_attention: true, jinja: true},
  speculation: null, memory: {ram_class_gib: 8, wired_limit_note: null}, evidence: [], limitations: [],
  expert: {context_presets: [{tokens: 2048, label: '2K', ubatch: 1}, {tokens: 4096, label: '4K', ubatch: 1}]},
};

test('discovers exact profile filenames recursively and checks sizes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-discovery-test.'));
  try {
    const nested = join(root, 'nested', 'model');
    await mkdir(nested, {recursive: true});
    await writeFile(join(nested, 'fixture.gguf'), '123456');
    const candidates = await discoverModels([fixtureProfile], [root]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.complete, true);
    await writeFile(join(nested, 'fixture.gguf'), 'short');
    const mismatched = await discoverModels([fixtureProfile], [root]);
    assert.equal(mismatched[0]?.complete, false);
    assert.match(mismatched[0]?.issues[0] ?? '', /expected 6/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('accepts an explicit separate draft directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-discovery-draft-test.'));
  try {
    const modelDirectory = join(root, 'model');
    const draftDirectory = join(root, 'draft');
    await mkdir(modelDirectory, {recursive: true});
    await mkdir(draftDirectory, {recursive: true});
    await writeFile(join(modelDirectory, 'fixture.gguf'), '123456');
    await writeFile(join(draftDirectory, 'draft.gguf'), '1234');
    const profile: ProfileDescriptor = {...fixtureProfile, draft: [{name: 'draft.gguf', bytes: 4, sha256: '1'.repeat(64)}]};
    const {candidateFromModelPath} = await import('../discovery.js');
    const candidate = await candidateFromModelPath(profile, join(modelDirectory, 'fixture.gguf'), join(draftDirectory, 'draft.gguf'));
    assert.equal(candidate.complete, true);
    assert.equal(candidate.draftPath, join(draftDirectory, 'draft.gguf'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('pairs a discovered draft from another model root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-discovery-pair-test.'));
  try {
    const modelDirectory = join(root, 'models', 'target');
    const draftDirectory = join(root, 'drafts', 'assistant');
    await mkdir(modelDirectory, {recursive: true});
    await mkdir(draftDirectory, {recursive: true});
    await writeFile(join(modelDirectory, 'fixture.gguf'), '123456');
    await writeFile(join(draftDirectory, 'draft.gguf'), '1234');
    const profile: ProfileDescriptor = {...fixtureProfile, draft: [{name: 'draft.gguf', bytes: 4, sha256: '1'.repeat(64)}]};
    const candidates = await discoverModels([profile], [join(root, 'models'), join(root, 'drafts')]);
    assert.equal(candidates[0]?.complete, true);
    assert.equal(candidates[0]?.draftPath, await realpath(join(draftDirectory, 'draft.gguf')));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
