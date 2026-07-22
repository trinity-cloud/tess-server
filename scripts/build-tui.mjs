import {chmod, rm} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(repo, 'build');
await rm(output, {recursive: true, force: true});
const result = spawnSync(join(repo, 'node_modules', '.bin', 'tsc'), ['--project', join(repo, 'tsconfig.json')], {cwd: repo, stdio: 'inherit'});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
await chmod(join(output, 'cli.js'), 0o755);
