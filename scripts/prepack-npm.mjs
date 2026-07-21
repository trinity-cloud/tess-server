import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySidecar} from './verify-npm-sidecar.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tests = spawnSync(process.execPath, [join(repo, 'scripts', 'test-tui.mjs')], {cwd: repo, stdio: 'inherit'});
if (tests.error) throw tests.error;
if (tests.status !== 0) process.exit(tests.status ?? 1);
const report = await verifySidecar();
console.log(`prepack sidecar: PASS (${report.version}, ${report.engineCommit})`);
