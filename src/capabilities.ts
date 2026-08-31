import type {RuntimeCapabilities} from './types.js';

function positive(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`invalid runtime capability: ${field}`);
  return value as number;
}

export function parseRuntimeCapabilities(value: unknown): RuntimeCapabilities {
  if (!value || typeof value !== 'object') throw new Error('runtime capabilities must be an object');
  const input = value as Record<string, unknown>;
  const defaults = input.default_generation_settings && typeof input.default_generation_settings === 'object'
    ? input.default_generation_settings as Record<string, unknown> : {};
  const runtime = input.runtime;
  if (runtime !== 'tess-mlx' && runtime !== 'gguf') throw new Error('invalid runtime capability: runtime');
  const features = input.features && typeof input.features === 'object'
    ? input.features as Record<string, unknown> : {};
  return {
    schemaVersion: 1,
    runtime,
    model: typeof input.model === 'string' ? input.model : 'local-llama-server',
    contextWindow: positive(input.context_window ?? input.n_ctx ?? defaults.n_ctx, 'context_window'),
    maxOutputTokens: positive(input.max_output_tokens ?? input.context_window ?? input.n_ctx ?? defaults.n_ctx, 'max_output_tokens'),
    slots: positive(input.slots ?? input.n_slots ?? input.total_slots ?? 1, 'slots'),
    speculation: typeof input.speculation === 'string' ? input.speculation : 'unknown',
    features: {
      chatCompletions: features.chat_completions !== false,
      streaming: features.streaming !== false,
      tools: features.tools !== false,
      reasoning: features.reasoning !== false,
    },
  };
}

export async function fetchRuntimeCapabilities(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeCapabilities> {
  const root = baseUrl.replace(/\/$/u, '');
  const direct = await fetchImpl(`${root}/v1/tess/capabilities`, {signal: AbortSignal.timeout(1500)});
  if (direct.ok) return parseRuntimeCapabilities(await direct.json());
  const props = await fetchImpl(`${root}/props`, {signal: AbortSignal.timeout(1500)});
  if (!props.ok) throw new Error(`runtime capabilities unavailable: HTTP ${props.status}`);
  const value = await props.json() as Record<string, unknown>;
  return parseRuntimeCapabilities({...value, runtime: value.runtime ?? 'gguf'});
}

export interface RequestBudget {
  contextWindow: number;
  estimatedPromptTokens: number;
  requestedMaxTokens: number;
  effectiveMaxTokens: number;
  compactionThresholdTokens: number;
  clamped: boolean;
}

export function deriveRequestBudget(
  capabilities: RuntimeCapabilities,
  estimatedPromptTokens: number,
  requestedMaxTokens: number,
): RequestBudget {
  if (!Number.isSafeInteger(estimatedPromptTokens) || estimatedPromptTokens < 0 ||
      !Number.isSafeInteger(requestedMaxTokens) || requestedMaxTokens < 0) {
    throw new Error('request budget values must be non-negative integers');
  }
  const reserve = Math.max(256, Math.min(2048, Math.floor(capabilities.contextWindow * 0.02)));
  const available = Math.max(0, capabilities.contextWindow - estimatedPromptTokens - reserve);
  const effective = Math.min(requestedMaxTokens, capabilities.maxOutputTokens, available);
  return {
    contextWindow: capabilities.contextWindow,
    estimatedPromptTokens,
    requestedMaxTokens,
    effectiveMaxTokens: effective,
    compactionThresholdTokens: Math.max(1024, capabilities.contextWindow - reserve - Math.min(4096, Math.floor(capabilities.contextWindow * 0.1))),
    clamped: effective !== requestedMaxTokens,
  };
}
