import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {RuntimeKind} from './types.js';

const execFileAsync = promisify(execFile);

export function chooserScript(runtime: RuntimeKind): string {
  return runtime === 'tess-mlx'
    ? 'POSIX path of (choose folder with prompt "Choose a Tess MLX model folder")'
    // `gguf` is a filename extension, not a registered macOS UTI on every
    // machine. Validate the extension after selection rather than making the
    // native chooser silently hide otherwise valid model files.
    : 'POSIX path of (choose file with prompt "Choose a GGUF model")';
}

export async function chooseModelPath(runtime: RuntimeKind): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  try {
    const {stdout} = await execFileAsync('/usr/bin/osascript', ['-e', chooserScript(runtime)], {
      timeout: 120_000,
      maxBuffer: 16 * 1024,
    });
    const path = stdout.trim();
    return path.length > 0 ? path : undefined;
  } catch (error) {
    const code = (error as {code?: string | number}).code;
    if (code === 1 || code === '1') return undefined;
    throw error;
  }
}
