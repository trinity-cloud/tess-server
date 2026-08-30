import type {StartupPhase, StartupProgress} from './types.js';

const prefix = 'TESS_PROGRESS ';
const phases = new Set<StartupPhase>([
  'inspecting_model', 'opening_weights', 'loading_weights',
  'preparing_runtime', 'starting_api', 'ready',
]);

export function parseProgressLine(line: string, receivedAt = Date.now()): StartupProgress | undefined {
  const index = line.indexOf(prefix);
  if (index < 0) return undefined;
  let value: unknown;
  try { value = JSON.parse(line.slice(index + prefix.length)); } catch { return undefined; }
  if (!value || typeof value !== 'object') return undefined;
  const event = value as Record<string, unknown>;
  if (event.schema_version !== 1 || !Number.isSafeInteger(event.sequence) ||
      typeof event.phase !== 'string' || !phases.has(event.phase as StartupPhase) ||
      !Number.isFinite(event.elapsed_ms) || typeof event.message !== 'string') return undefined;
  const output: StartupProgress = {
    schemaVersion: 1,
    sequence: event.sequence as number,
    phase: event.phase as StartupPhase,
    elapsedMs: event.elapsed_ms as number,
    message: event.message,
    receivedAt,
  };
  if (Number.isFinite(event.completed) && Number.isFinite(event.total) && (event.total as number) > 0) {
    output.completed = event.completed as number;
    output.total = event.total as number;
  }
  if (typeof event.current === 'string' && event.current.length > 0) output.current = event.current;
  return output;
}

export class ProgressLineDecoder {
  #pending = '';

  push(chunk: string): string[] {
    this.#pending += chunk;
    const parts = this.#pending.split(/\r\n|\n|\r/u);
    this.#pending = parts.pop() ?? '';
    return parts.filter(Boolean);
  }

  finish(): string[] {
    const line = this.#pending;
    this.#pending = '';
    return line ? [line] : [];
  }
}

export function coarseProgressFromLog(line: string, sequence: number, startedAt: number): StartupProgress | undefined {
  const lower = line.toLowerCase();
  let phase: StartupPhase | undefined;
  let message = '';
  if (/loading model|load_model|llama_model_loader/u.test(lower)) {
    phase = 'opening_weights'; message = 'Opening GGUF model';
  } else if (/load_tensors|loading tensors|offload/u.test(lower)) {
    phase = 'loading_weights'; message = 'Loading GGUF weights';
  } else if (/warmup|initialize|kv cache/u.test(lower)) {
    phase = 'preparing_runtime'; message = 'Preparing GGUF runtime';
  } else if (/listening|server is ready|http server/u.test(lower)) {
    phase = 'starting_api'; message = 'Starting loopback API';
  }
  if (!phase) return undefined;
  return {schemaVersion: 1, sequence, phase, elapsedMs: Date.now() - startedAt, message, receivedAt: Date.now()};
}

export function progressLabel(progress: StartupProgress | undefined, now = Date.now()): string {
  if (!progress) return 'Starting…';
  const detail = progress.current ? ` · ${progress.current}` : '';
  const count = progress.total && progress.completed !== undefined
    ? ` · ${progress.completed}/${progress.total}` : '';
  const stale = now - progress.receivedAt >= 5000
    ? ` · Still working — last update ${Math.floor((now - progress.receivedAt) / 1000)}s ago`
    : '';
  return `${progress.message}${detail}${count}${stale}`;
}
