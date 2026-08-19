import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, realpath, rm, cp, mkdir, writeFile, chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {basename, dirname, join, posix, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {repoRoot, verifySidecar} from './verify-npm-sidecar.mjs';

async function sha256(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

const archiveArgument = process.argv[2];
if (!archiveArgument || process.argv.length !== 3) {
  console.error('usage: npm run sidecar:stage -- <tess-server-release.tar.gz>');
  process.exit(2);
}
const archive = await realpath(resolve(archiveArgument));
const archiveName = basename(archive);
const archiveSha = await sha256(archive);
const releaseChecksums = await readFile(join(dirname(archive), 'SHA256SUMS'), 'utf8');
const expectedRows = releaseChecksums.trim().split('\n').filter(line => line.endsWith(`  ${archiveName}`));
if (expectedRows.length !== 1 || expectedRows[0]?.split(/\s+/)[0] !== archiveSha) {
  throw new Error('release archive does not match the unique adjacent SHA256SUMS entry');
}

const listing = spawnSync('/usr/bin/tar', ['-tzf', archive], {encoding: 'utf8'});
if (listing.status !== 0) throw new Error(`cannot list release archive: ${listing.stderr}`);
for (const rawName of listing.stdout.split('\n').filter(Boolean)) {
  const name = rawName.replace(/\/$/, '');
  if (posix.isAbsolute(name) || name.split('/').includes('..')) throw new Error(`unsafe release archive path: ${rawName}`);
}

const destination = join(repoRoot, 'sidecar', 'darwin-arm64');
let existingMetadata;
try {
  existingMetadata = JSON.parse(await readFile(join(destination, 'npm-sidecar.json'), 'utf8'));
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
}
if (existingMetadata) {
  if (existingMetadata.source_archive_sha256 === archiveSha) {
    const report = await verifySidecar(destination);
    console.log(`npm sidecar already staged and verified: ${report.root}`);
    process.exit(0);
  }
  throw new Error('a different sidecar is already staged; remove sidecar/darwin-arm64 before changing release inputs');
}

const temporary = await mkdtemp(join(tmpdir(), 'tess-npm-sidecar.'));
let createdDestination = false;
try {
  const extraction = join(temporary, 'extract');
  await mkdir(extraction);
  const result = spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', extraction], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`cannot extract release archive: ${result.stderr}`);
  const topLevel = await readdir(extraction, {withFileTypes: true});
  const directories = topLevel.filter(entry => entry.isDirectory());
  if (topLevel.length !== 1 || directories.length !== 1 || !directories[0]) throw new Error('release archive must contain exactly one payload directory');
  const payload = join(extraction, directories[0].name);
  const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(payload, 'share', 'tess-server', 'manifest.json'), 'utf8'));
  if (manifest.product !== 'tess-server' || manifest.version !== packageJson.version) throw new Error('release payload version does not match package.json');
  await mkdir(dirname(destination), {recursive: true});
  createdDestination = true;
  await cp(payload, destination, {recursive: true, preserveTimestamps: true, errorOnExist: true, force: false});
  await writeFile(join(destination, 'npm-sidecar.json'), `${JSON.stringify({schema_version: 1, platform: 'darwin-arm64', source_archive: archiveName, source_archive_sha256: archiveSha, release_build_id: manifest.build_id, engine_commit: manifest.engine_commit}, null, 2)}\n`, {mode: 0o644});
  for (const variant of Object.values(manifest.engine_variants ?? {})) {
    if (!variant || typeof variant !== 'object' || typeof variant.binary !== 'string') throw new Error('release manifest contains an invalid engine variant');
    await chmod(join(destination, variant.binary), 0o755);
  }
  const report = await verifySidecar(destination);
  console.log(`npm sidecar staged: ${report.root}`);
  console.log(`source archive sha256: ${report.sourceArchiveSha256}`);
} catch (error) {
  if (createdDestination) await rm(destination, {recursive: true, force: true});
  throw error;
} finally {
  await rm(temporary, {recursive: true, force: true});
}
