import {access, readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isProfileRoot(root: string): Promise<boolean> {
  return exists(join(root, 'profiles'));
}

export async function isRuntimePayload(root: string): Promise<boolean> {
  const required = [
    'bin/tess-server',
    'bin/default.metallib',
    'profiles',
    'scripts/profile-common.sh',
    'share/tess-server/manifest.json',
    'SHA256SUMS',
  ];
  return (await Promise.all(required.map(async item => exists(join(root, item))))).every(Boolean);
}

export async function resolveProfileRoot(explicitRoot?: string): Promise<string> {
  if (explicitRoot) {
    const root = resolve(explicitRoot);
    if (!(await isProfileRoot(root))) {
      throw new Error(`profile directory is missing under sidecar root: ${root}`);
    }
    return root;
  }

  const packaged = join(packageRoot, 'sidecar', 'darwin-arm64');
  if (await isProfileRoot(packaged)) {
    return packaged;
  }
  if (await isProfileRoot(packageRoot)) {
    return packageRoot;
  }
  throw new Error('Tess Server profiles are missing from this installation');
}

export async function requireRuntimePayload(explicitRoot?: string): Promise<string> {
  const root = await resolveProfileRoot(explicitRoot);
  if (!(await isRuntimePayload(root))) {
    throw new Error('the proprietary Tess Server sidecar is not staged; run `npm run sidecar:stage -- <release.tar.gz>` when developing from source');
  }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`the bundled engine supports macOS arm64; current host is ${process.platform} ${process.arch}`);
  }
  return root;
}

export async function readPackageVersion(): Promise<string> {
  const raw = await readFile(join(packageRoot, 'package.json'), 'utf8');
  const data = JSON.parse(raw) as {version?: unknown};
  if (typeof data.version !== 'string') {
    throw new Error('package.json does not contain a version');
  }
  return data.version;
}
