import assert from 'node:assert/strict';
import test from 'node:test';
import {serveSpec, verifySpec} from '../launch.js';
import type {ModelCandidate, ProfileDescriptor} from '../types.js';

const profile = {
  profile_id: 'qwen36-a3b-q8-q4mtp',
  context: {default: 262144},
} as ProfileDescriptor;
const candidate: ModelCandidate = {profile, modelPath: '/Volumes/models/tess.gguf', complete: true, issues: []};

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
