import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveRequestBudget, parseRuntimeCapabilities} from '../capabilities.js';

test('derives request budgets from the active runtime instead of a global alias', () => {
  const mlx = parseRuntimeCapabilities({
    schema_version: 1, runtime: 'tess-mlx', model: 'local-llama-server',
    context_window: 32768, max_output_tokens: 32768, slots: 1, speculation: 'off', features: {},
  });
  const gguf = parseRuntimeCapabilities({
    schema_version: 1, runtime: 'gguf', model: 'local-llama-server',
    context_window: 131072, max_output_tokens: 131072, slots: 1, speculation: 'mtp', features: {},
  });
  const mlxBudget = deriveRequestBudget(mlx, 20937, 64000);
  assert.equal(mlxBudget.clamped, true);
  assert.ok(mlxBudget.effectiveMaxTokens < 12000);
  assert.ok(mlxBudget.estimatedPromptTokens + mlxBudget.effectiveMaxTokens < mlx.contextWindow);
  const ggufBudget = deriveRequestBudget(gguf, 20937, 64000);
  assert.equal(ggufBudget.clamped, false);
  assert.equal(ggufBudget.effectiveMaxTokens, 64000);
  assert.ok(ggufBudget.compactionThresholdTokens > mlxBudget.compactionThresholdTokens);
});

test('parses the real llama.cpp props capability shape', () => {
  assert.deepEqual(parseRuntimeCapabilities({
    runtime: 'gguf',
    default_generation_settings: {n_ctx: 131072},
    total_slots: 1,
  }), {
    schemaVersion: 1,
    runtime: 'gguf',
    model: 'local-llama-server',
    contextWindow: 131072,
    maxOutputTokens: 131072,
    slots: 1,
    speculation: 'unknown',
    features: {chatCompletions: true, streaming: true, tools: true, reasoning: true},
  });
});

test('rejects malformed capability records', () => {
  assert.throws(() => parseRuntimeCapabilities({runtime: 'python', context_window: 1}), /runtime/);
  assert.throws(() => parseRuntimeCapabilities({runtime: 'gguf', context_window: 0}), /context_window/);
});
