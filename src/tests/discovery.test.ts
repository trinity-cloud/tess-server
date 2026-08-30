import assert from 'node:assert/strict';
import {mkdtemp, mkdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {discoverModels} from '../discovery.js';
import type {ProfileDescriptor} from '../types.js';

function gguf(suffix = ''): Buffer {
  const header = Buffer.alloc(8);
  header.write('GGUF', 0, 'ascii');
  header.writeUInt32LE(3, 4);
  return Buffer.concat([header, Buffer.from(suffix)]);
}

const fixtureProfile: ProfileDescriptor = {
  profile_id: 'fixture', schema_version: 2,
  engine: {min_version: '0.1.0', max_version: null},
  model: {name: 'Fixture Model', architecture: 'fixture', quant_label: 'Q4', total_params: '1B', active_params: '1B'},
  shards: [{name: 'fixture.gguf', bytes: 8, sha256: '0'.repeat(64)}], draft: null,
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
    await writeFile(join(nested, 'fixture.gguf'), gguf());
    const candidates = await discoverModels([fixtureProfile], [root]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.kind, 'profiled');
    assert.equal(candidates[0]?.complete, true);
    await writeFile(join(nested, 'fixture.gguf'), 'short');
    const mismatched = await discoverModels([fixtureProfile], [root]);
    assert.equal(mismatched[0]?.complete, false);
    assert.match(mismatched[0]?.issues[0] ?? '', /expected 8/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('discovers a profiled MLX model directory by its safetensors index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-discovery-mlx-test.'));
  try {
    const modelDirectory = join(root, 'DeepSeek-MLX');
    await mkdir(modelDirectory, {recursive: true});
    const index = JSON.stringify({weight_map: {weight: 'model-00001-of-00001.safetensors'}});
    await writeFile(join(modelDirectory, 'model.safetensors.index.json'), index);
    await writeFile(join(modelDirectory, 'model-00001-of-00001.safetensors'), 'weights');
    const profile: ProfileDescriptor = {
      ...fixtureProfile,
      profile_id: 'fixture-mlx',
      model: {...fixtureProfile.model, format: 'mlx', quant_label: '2.4-bit mixed MLX'},
      shards: [
        {name: 'model.safetensors.index.json', bytes: Buffer.byteLength(index), sha256: '0'.repeat(64)},
        {name: 'model-00001-of-00001.safetensors', bytes: 7, sha256: '1'.repeat(64)},
      ],
    };
    const candidates = await discoverModels([profile], [root]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.kind, 'profiled');
    assert.equal(candidates[0]?.modelPath, await realpath(modelDirectory));
    assert.equal(candidates[0]?.complete, true);

    const unrelatedDirectory = join(root, 'Unrelated-MLX');
    await mkdir(unrelatedDirectory, {recursive: true});
    await writeFile(join(unrelatedDirectory, 'model.safetensors.index.json'), 'x'.repeat(Buffer.byteLength(index)));
    const withoutFalseMatch = await discoverModels([profile], [root]);
    assert.equal(withoutFalseMatch.length, 1);
    assert.equal(withoutFalseMatch[0]?.modelPath, await realpath(modelDirectory));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('discovers unmatched GGUF files as unprofiled best-effort candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-discovery-generic-test.'));
  try {
    const directory = join(root, 'models', 'tess');
    await mkdir(directory, {recursive: true});
    const path = join(directory, 'Tess-4-27B-Q4_K_M.gguf');
    await writeFile(path, gguf('generic-model'));
    const mmprojPath = join(directory, 'mmproj-Tess-4-27B-F16.gguf');
    const mtpPath = join(directory, 'mtp-Tess-4-27B-Q4_K_M.gguf');
    const draftHeadPath = join(directory, 'tess-draft-head-Q4_0.gguf');
    await writeFile(mmprojPath, gguf('projector'));
    await writeFile(mtpPath, gguf('draft'));
    await writeFile(draftHeadPath, gguf('head'));
    const candidates = await discoverModels([fixtureProfile], [root]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.kind, 'unprofiled');
    assert.equal(candidates[0]?.profile.model.name, 'Tess-4-27B-Q4_K_M');
    assert.equal(candidates[0]?.profile.model.quant_label, 'Generic GGUF');
    assert.equal(candidates[0]?.modelPath, await realpath(path));
    assert.equal(candidates[0]?.complete, true);
    assert.deepEqual(candidates[0]?.companions?.mmproj, [await realpath(mmprojPath)]);
    assert.deepEqual(candidates[0]?.companions?.draft, [await realpath(mtpPath), await realpath(draftHeadPath)]);
    assert.equal(candidates[0]?.companions?.recommendedMmproj, await realpath(mmprojPath));
    assert.equal(candidates[0]?.companions?.recommendedDraft, await realpath(mtpPath));
    assert.equal(candidates[0]?.companions?.recommendedSpeculation, 'draft-mtp');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('shows one unprofiled entry for a sharded GGUF collection and reports missing shards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-discovery-generic-shards-test.'));
  try {
    await writeFile(join(root, 'model-00001-of-00003.gguf'), gguf('first'));
    await writeFile(join(root, 'model-00002-of-00003.gguf'), gguf('second'));
    const candidates = await discoverModels([], [root]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.kind, 'unprofiled');
    assert.equal(candidates[0]?.profile.model.name, 'model');
    assert.equal(candidates[0]?.complete, false);
    assert.deepEqual(candidates[0]?.issues, ['missing model-00003-of-00003.gguf']);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('matches an MTP companion to a primary model carrying a base suffix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-discovery-base-companion-test.'));
  try {
    const modelPath = join(root, 'Qwen3.6-35B-A3B-base.gguf');
    const draftPath = join(root, 'mtp-Qwen3.6-35B-A3B-Q4_0.gguf');
    await writeFile(modelPath, gguf('model'));
    await writeFile(draftPath, gguf('draft'));
    const candidates = await discoverModels([], [root]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.companions?.recommendedDraft, await realpath(draftPath));
    assert.equal(candidates[0]?.companions?.recommendedSpeculation, 'draft-mtp');
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
    await writeFile(join(modelDirectory, 'fixture.gguf'), gguf());
    await writeFile(join(draftDirectory, 'draft.gguf'), gguf());
    const profile: ProfileDescriptor = {...fixtureProfile, draft: [{name: 'draft.gguf', bytes: 8, sha256: '1'.repeat(64)}]};
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
    await writeFile(join(modelDirectory, 'fixture.gguf'), gguf());
    await writeFile(join(draftDirectory, 'draft.gguf'), gguf());
    const profile: ProfileDescriptor = {...fixtureProfile, draft: [{name: 'draft.gguf', bytes: 8, sha256: '1'.repeat(64)}]};
    const candidates = await discoverModels([profile], [join(root, 'models'), join(root, 'drafts')]);
    assert.equal(candidates[0]?.complete, true);
    assert.equal(candidates[0]?.draftPath, await realpath(join(draftDirectory, 'draft.gguf')));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
