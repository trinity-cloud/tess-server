import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCliArgs} from '../args.js';

test('defaults to the TUI', () => {
  assert.deepEqual(parseCliArgs([]), {command: 'tui', modelRoots: [], noAuth: false, printConfig: false, json: false, version: false, engineArgs: []});
});

test('parses verified serve options', () => {
  const options = parseCliArgs(['serve', '--profile', 'qwen36-a3b-q8-q4mtp', '--model', '/models/tess.gguf', '--context', '32768', '--port', '8787']);
  assert.equal(options.command, 'serve');
  assert.equal(options.profile, 'qwen36-a3b-q8-q4mtp');
  assert.equal(options.model, '/models/tess.gguf');
  assert.equal(options.context, 32768);
  assert.equal(options.port, 8787);
});

test('forwards raw engine arguments', () => {
  assert.deepEqual(parseCliArgs(['engine', '--', '--help']).engineArgs, ['--help']);
});

test('rejects invalid ports and unknown flags', () => {
  assert.throws(() => parseCliArgs(['--port', '70000']), /at most 65535/);
  assert.throws(() => parseCliArgs(['--wat']), /unknown argument/);
  assert.throws(() => parseCliArgs(['--logo', 'silicon']), /unknown argument/);
});

test('parses expert and authentication options', () => {
  const options = parseCliArgs(['serve', '--profile', 'dsv4-dspark', '--model', '/models/dsv4.gguf', '--speculation', 'off', '--draft-depth', '3', '--p-min', '0.8', '--api-key-file', '/keys/local.key', '--print-config']);
  assert.equal(options.speculation, 'off');
  assert.equal(options.draftDepth, 3);
  assert.equal(options.pMin, 0.8);
  assert.equal(options.apiKeyFile, '/keys/local.key');
  assert.equal(options.printConfig, true);
});
