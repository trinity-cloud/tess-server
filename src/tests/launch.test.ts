import assert from 'node:assert/strict';
import test from 'node:test';
import {serveSpec, verifySpec} from '../launch.js';
import type {ModelCandidate, ProfileDescriptor} from '../types.js';

const profile = {
  profile_id: 'qwen36-a3b-q8-q4mtp',
  context: {default: 262144},
} as ProfileDescriptor;
const candidate: ModelCandidate = {kind: 'profiled', profile, modelPath: '/Volumes/models/tess.gguf', complete: true, issues: []};

test('builds a packaged verified launcher spec', () => {
  const spec = serveSpec('/payload', candidate, {context: 32768, port: 9000, apiKeyFile: '/keys/local.key', reasoning: 'low'});
  assert.deepEqual(spec.args, ['/payload/scripts/serve/serve-qwen36.sh']);
  assert.equal(spec.env.TESS_PACKAGE_ROOT, '/payload');
  assert.equal(spec.env.MODEL, candidate.modelPath);
  assert.equal(spec.env.CTX, '32768');
  assert.equal(spec.env.PORT, '9000');
  assert.equal(spec.env.API_KEY_FILE, '/keys/local.key');
  assert.equal(spec.env.REASONING, 'low');
});

test('builds a profile verifier spec', () => {
  const spec = verifySpec('/payload', candidate);
  assert.deepEqual(spec.args, ['/payload/scripts/verify-profile.sh', 'qwen36-a3b-q8-q4mtp', candidate.modelPath]);
});

test('passes an exact companion to profiled DFlash launchers', () => {
  const lagunaProfile = {...profile, profile_id: 'laguna-s21-q4km-dflash'} as ProfileDescriptor;
  const laguna: ModelCandidate = {
    kind: 'profiled', profile: lagunaProfile, modelPath: '/models/laguna.gguf', draftPath: '/models/laguna-dflash.gguf', complete: true, issues: [],
  };
  const spec = serveSpec('/payload', laguna);
  assert.deepEqual(spec.args, ['/payload/scripts/serve/serve-laguna.sh']);
  assert.equal(spec.env.DRAFT_MODEL, laguna.draftPath);
  assert.equal(spec.env.DSPARK, laguna.draftPath);
  assert.deepEqual(verifySpec('/payload', laguna).args, ['/payload/scripts/verify-profile.sh', 'laguna-s21-q4km-dflash', laguna.modelPath, laguna.draftPath]);
});

test('maps every 0.1.4 profile to its packaged launcher', () => {
  assert.equal(serveSpec('/payload', {...candidate, profile: {...profile, profile_id: 'qwen35-122b-a10b-q4km'} as ProfileDescriptor}).args[0], '/payload/scripts/serve/serve-qwen35-122b.sh');
  assert.equal(serveSpec('/payload', {...candidate, profile: {...profile, profile_id: 'inkling-small-iq3xxs'} as ProfileDescriptor}).args[0], '/payload/scripts/serve/serve-inkling.sh');
  assert.equal(serveSpec('/payload', {...candidate, profile: {...profile, profile_id: 'dsv4-0731-dspark'} as ProfileDescriptor}).args[0], '/payload/scripts/serve/serve-dsv4-0731.sh');

  const muse: ModelCandidate = {
    kind: 'profiled',
    profile: {...profile, profile_id: 'muse-glimmer-30b-kquant-dflash'} as ProfileDescriptor,
    modelPath: '/models/muse.gguf',
    draftPath: '/models/dflash.gguf',
    complete: true,
    issues: [],
  };
  const spec = serveSpec('/payload', muse);
  assert.equal(spec.args[0], '/payload/scripts/serve/serve-muse.sh');
  assert.equal(spec.env.DRAFT_MODEL, muse.draftPath);
});

test('builds a configurable generic GGUF launcher with detected companions', () => {
  const genericProfile = {
    ...profile,
    profile_id: 'unprofiled:/Volumes/models/generic.gguf',
    context: {default: 4096},
    runtime: {batch: 512, ubatch: 512},
    expert: {context_presets: [{tokens: 4096, label: '4K', batch: 512, ubatch: 512}]},
  } as ProfileDescriptor;
  const generic: ModelCandidate = {
    kind: 'unprofiled', profile: genericProfile, modelPath: '/Volumes/models/generic.gguf', complete: true, issues: [],
    companions: {
      mmproj: ['/Volumes/models/mmproj-generic.gguf'], draft: ['/Volumes/models/mtp-generic.gguf'],
      recommendedMmproj: '/Volumes/models/mmproj-generic.gguf', recommendedDraft: '/Volumes/models/mtp-generic.gguf', recommendedSpeculation: 'draft-mtp',
    },
  };
  const spec = serveSpec('/payload', generic, {context: 4096, port: 9000, alias: 'local-model', apiKeyFile: '/keys/local.key', rawEngineArgs: '--threads 12'});
  assert.equal(spec.command, '/payload/bin/tess-server');
  assert.deepEqual(spec.args.slice(0, 2), ['--threads', '12']);
  const valueFor = (option: string): string | undefined => spec.args[spec.args.indexOf(option) + 1];
  assert.equal(valueFor('-m'), generic.modelPath);
  assert.equal(valueFor('-c'), '4096');
  assert.equal(valueFor('-b'), '512');
  assert.equal(valueFor('-ub'), '512');
  assert.equal(valueFor('-ctk'), 'f16');
  assert.equal(valueFor('-ctv'), 'f16');
  assert.equal(valueFor('-ngl'), 'all');
  assert.equal(valueFor('-fa'), 'auto');
  assert.equal(valueFor('-np'), '1');
  assert.equal(valueFor('-mm'), '/Volumes/models/mmproj-generic.gguf');
  assert.equal(valueFor('--spec-type'), 'draft-mtp');
  assert.equal(valueFor('-md'), '/Volumes/models/mtp-generic.gguf');
  assert.equal(valueFor('--spec-draft-n-max'), '3');
  assert.equal(valueFor('--spec-draft-p-min'), '0');
  assert.deepEqual(spec.args.slice(-8), ['--alias', 'local-model', '--host', '127.0.0.1', '--port', '9000', '--api-key-file', '/keys/local.key']);
  assert.throws(() => verifySpec('/payload', generic), /do not have a Tess verification manifest/);
});
