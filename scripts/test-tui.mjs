import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let result = spawnSync(process.execPath, [join(repo, 'scripts', 'build-tui.mjs')], {cwd: repo, stdio: 'inherit'});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
const testsDirectory = join(repo, 'build', 'tests');
const tests = (await readdir(testsDirectory)).filter(file => file.endsWith('.test.js')).sort().map(file => join(testsDirectory, file));
if (tests.length === 0) {
  throw new Error('no compiled TUI tests found');
}
result = spawnSync(process.execPath, ['--test', ...tests], {cwd: repo, stdio: 'inherit'});
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
