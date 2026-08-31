import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coarseProgressFromLog,
  parseProgressLine,
  progressLabel,
  progressLogLine,
  ProgressLineDecoder,
} from '../progress.js';

test('decodes fragmented structured progress without exposing it as a log', () => {
  const decoder = new ProgressLineDecoder();
  assert.deepEqual(decoder.push('TESS_PROGRESS {"schema_version":1,"sequence":2,'), []);
  const lines = decoder.push('"phase":"loading_weights","elapsed_ms":1250,"message":"Loading weights","completed":2,"total":18,"current":"shard 2"}\nnext');
  assert.equal(lines.length, 1);
  const event = parseProgressLine(lines[0]!, 5000);
  assert.equal(event?.phase, 'loading_weights');
  assert.equal(event?.completed, 2);
  assert.equal(event?.current, 'shard 2');
  assert.equal(progressLogLine(event!), '[1s] Loading weights · shard 2 · 2/18');
  assert.deepEqual(decoder.finish(), ['next']);
});

test('maps GGUF logs coarsely and calls out a stale-but-live load', () => {
  const event = coarseProgressFromLog('llama_model_loader: loading model', 3, Date.now() - 9000);
  assert.equal(event?.phase, 'opening_weights');
  assert.match(progressLabel({...event!, receivedAt: 1000}, 8000), /Still working/);
  assert.equal(parseProgressLine('ordinary log'), undefined);
});
