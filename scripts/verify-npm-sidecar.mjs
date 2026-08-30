import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, readFile, readdir, stat} from 'node:fs/promises';
import {constants, createReadStream} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

async function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`sidecar contains a link or special file: ${relative(root, path)}`);
    }
  }
  return files;
}

export async function verifySidecar(root = process.env.TESS_NPM_SIDECAR_ROOT || join(repoRoot, 'sidecar', 'darwin-arm64')) {
  const payloadFiles = await listFiles(root);
  const required = [
    'bin/tess-server', 'bin/default.metallib',
    'bin/upstream/tess-server', 'bin/upstream/default.metallib',
    'bin/mlx/tess-mlx-server', 'bin/mlx/libmlx.dylib',
    'bin/mlx/libjaccl.dylib', 'bin/mlx/mlx.metallib',
    'profiles', 'scripts/inspect-model.sh', 'scripts/verify-profile.sh', 'scripts/verify-payload.sh',
    'share/tess-server/manifest.json',
    'share/tess-server/mlx/model-profile.json',
    'share/tess-server/mlx/tess-mlx-manifest.json',
    'SHA256SUMS', 'npm-sidecar.json',
  ];
  for (const item of required) {
    await access(join(root, item), constants.R_OK);
  }
  await access(join(root, 'bin', 'tess-server'), constants.X_OK);
  await access(join(root, 'bin', 'mlx', 'tess-mlx-server'), constants.X_OK);

  const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'share', 'tess-server', 'manifest.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(join(root, 'npm-sidecar.json'), 'utf8'));
  if (packageJson.license !== 'SEE LICENSE IN LICENSE' || packageJson.private === true || packageJson.publishConfig?.access !== 'public') {
    throw new Error('npm package split-license metadata is not publishable');
  }
  if (manifest.product !== 'tess-server' || manifest.version !== packageJson.version) {
    throw new Error(`sidecar manifest ${manifest.product} ${manifest.version} does not match npm package ${packageJson.version}`);
  }
  if (manifest.license_status !== 'owner-approved') {
    throw new Error(`sidecar license is not owner-approved: ${manifest.license_status ?? 'missing status'}`);
  }
  const engineVariants = manifest.engine_variants;
  if (!engineVariants || typeof engineVariants !== 'object' || !engineVariants.primary || !engineVariants.upstream) {
    throw new Error('sidecar manifest does not declare the primary and upstream engine variants');
  }
  const tessMlx = manifest.tess_mlx;
  const expectedTessMlxPaths = {
    binary: 'bin/mlx/tess-mlx-server',
    libmlx: 'bin/mlx/libmlx.dylib',
    libjaccl: 'bin/mlx/libjaccl.dylib',
    metallib: 'bin/mlx/mlx.metallib',
    model_profile: 'share/tess-server/mlx/model-profile.json',
    manifest: 'share/tess-server/mlx/tess-mlx-manifest.json',
  };
  const expectedTessMlxPolicy = {
    target_only: true,
    single_slot: true,
    loopback_only: true,
    python_runtime_included: false,
    python_source_included: false,
    model_payload_included: false,
    dspark_included: false,
  };
  if (!tessMlx || tessMlx.version !== packageJson.version || tessMlx.mlx_version !== '0.32.0' || tessMlx.source_archive_sha256?.length !== 64 ||
      Object.entries(expectedTessMlxPaths).some(([key, value]) => tessMlx[key] !== value) ||
      Object.entries(expectedTessMlxPolicy).some(([key, value]) => tessMlx.policy?.[key] !== value)) {
    throw new Error('sidecar manifest does not declare the qualified Tess MLX engine');
  }
  if (metadata.schema_version !== 1 || metadata.source_archive_sha256?.length !== 64 || metadata.platform !== 'darwin-arm64') {
    throw new Error('npm-sidecar.json is invalid');
  }
  const [packagedEngineLicense, currentEngineLicense] = await Promise.all([
    readFile(join(root, 'share', 'tess-server', 'LICENSE'), 'utf8'),
    readFile(join(repoRoot, 'LICENSE.md'), 'utf8'),
  ]);
  if (packagedEngineLicense !== currentEngineLicense) {
    throw new Error('packaged engine license does not match LICENSE.md');
  }

  const checksums = (await readFile(join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  for (const line of checksums) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`invalid payload checksum row: ${line}`);
    const [, expected, name] = match;
    const path = resolve(root, name);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`unsafe payload checksum path: ${name}`);
    if (await sha256(path) !== expected) throw new Error(`sidecar payload checksum mismatch: ${name}`);
  }

  const binary = join(root, 'bin', 'tess-server');
  const versionResult = spawnSync(binary, ['--version-json'], {encoding: 'utf8'});
  if (versionResult.status !== 0) throw new Error(`sidecar --version-json failed: ${versionResult.stderr}`);
  const version = JSON.parse(versionResult.stdout);
  if (version.product !== 'tess-server' || version.version !== packageJson.version || version.engine_commit !== manifest.engine_commit) {
    throw new Error('sidecar binary version contract does not match the npm package and release manifest');
  }
  const fileResult = spawnSync('/usr/bin/file', [binary], {encoding: 'utf8'});
  if (fileResult.status !== 0 || !fileResult.stdout.includes('Mach-O 64-bit executable arm64')) {
    throw new Error('sidecar engine is not a thin arm64 Mach-O executable');
  }
  for (const [variantId, variant] of Object.entries(engineVariants)) {
    if (!variant || typeof variant !== 'object' || typeof variant.binary !== 'string' || typeof variant.metallib !== 'string') {
      throw new Error(`invalid engine variant manifest entry: ${variantId}`);
    }
    const variantBinary = join(root, variant.binary);
    const variantMetallib = join(root, variant.metallib);
    await access(variantBinary, constants.X_OK);
    await access(variantMetallib, constants.R_OK);
    if (await sha256(variantBinary) !== variant.binary_sha256 || await sha256(variantMetallib) !== variant.metallib_sha256) {
      throw new Error(`engine variant checksum mismatch: ${variantId}`);
    }
    const variantFile = spawnSync('/usr/bin/file', [variantBinary], {encoding: 'utf8'});
    if (variantFile.status !== 0 || !variantFile.stdout.includes('Mach-O 64-bit executable arm64')) {
      throw new Error(`engine variant is not a thin arm64 Mach-O executable: ${variantId}`);
    }
  }
  for (const [key, relativePath] of Object.entries(expectedTessMlxPaths)) {
    const declaredHash = tessMlx[`${key}_sha256`];
    if (key !== 'model_profile' && key !== 'manifest' &&
        (typeof declaredHash !== 'string' || declaredHash.length !== 64 || await sha256(join(root, relativePath)) !== declaredHash)) {
      throw new Error(`Tess MLX payload checksum mismatch: ${key}`);
    }
  }
  const tessMlxBinary = join(root, tessMlx.binary);
  const tessMlxFile = spawnSync('/usr/bin/file', [tessMlxBinary], {encoding: 'utf8'});
  if (tessMlxFile.status !== 0 || !tessMlxFile.stdout.includes('Mach-O 64-bit executable arm64')) {
    throw new Error('Tess MLX server is not a thin arm64 Mach-O executable');
  }
  const tessMlxVersionResult = spawnSync(tessMlxBinary, ['--version-json'], {encoding: 'utf8'});
  if (tessMlxVersionResult.status !== 0) throw new Error(`Tess MLX --version-json failed: ${tessMlxVersionResult.stderr}`);
  const tessMlxVersion = JSON.parse(tessMlxVersionResult.stdout);
  if (tessMlxVersion.product !== 'tess-mlx-server' || tessMlxVersion.version !== packageJson.version ||
      tessMlxVersion.build_id !== tessMlx.build_id || tessMlxVersion.engine_commit !== tessMlx.engine_commit ||
      tessMlxVersion.mlx_commit !== tessMlx.mlx_commit || tessMlxVersion.distribution !== version.distribution ||
      tessMlxVersion.libmlx_sha256 !== tessMlx.libmlx_sha256 || tessMlxVersion.metallib_sha256 !== tessMlx.metallib_sha256) {
    throw new Error('Tess MLX version contract does not match the package manifest');
  }
  const dependencies = spawnSync('/usr/bin/otool', ['-L', tessMlxBinary], {encoding: 'utf8'});
  if (dependencies.status !== 0) throw new Error(`cannot inspect Tess MLX dependencies: ${dependencies.stderr}`);
  const unexpectedDependency = dependencies.stdout.split('\n').slice(1).map(line => line.trim().split(/\s+/)[0]).filter(Boolean)
    .find(path => path !== '@rpath/libmlx.dylib' && !path.startsWith('/System/Library/') && !path.startsWith('/usr/lib/'));
  if (unexpectedDependency) throw new Error(`Tess MLX server has an unexpected dependency: ${unexpectedDependency}`);
  const loadCommands = spawnSync('/usr/bin/otool', ['-l', tessMlxBinary], {encoding: 'utf8'});
  const rpaths = [...loadCommands.stdout.matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (\S+)/g)].map(match => match[1]);
  if (loadCommands.status !== 0 || rpaths.length !== 1 || rpaths[0] !== '@executable_path') {
    throw new Error('Tess MLX server is not relocatable through its adjacent library directory');
  }
  const tessMlxManifest = JSON.parse(await readFile(join(root, tessMlx.manifest), 'utf8'));
  if (tessMlxManifest.product !== 'tess-mlx' || tessMlxManifest.tess_server_version !== packageJson.version ||
      tessMlxManifest.build_id !== tessMlx.build_id || tessMlxManifest.engine_commit !== tessMlx.engine_commit ||
      tessMlxManifest.mlx_commit !== tessMlx.mlx_commit || tessMlxManifest.source_tree_clean !== true ||
      Object.entries(expectedTessMlxPolicy).some(([key, value]) => tessMlxManifest.policy?.[key] !== value)) {
    throw new Error('Tess MLX provenance manifest is inconsistent with the package');
  }
  const payloadRelativePaths = payloadFiles.map(path => relative(root, path));
  const forbidden = payloadRelativePaths.filter(path =>
    /\.(gguf|safetensors|metal|h|py|pyc)$/i.test(path) || /(^|\/)\.dSYM(\/|$)/i.test(path) ||
    /(^|\/)(python(?:3(?:\.\d+)?)?|site-packages|mlx[_-]lm|mlx[_-]vlm|omlx)(\/|$)/i.test(path));
  if (forbidden.length > 0) throw new Error(`forbidden model/source/debug material in npm sidecar: ${forbidden.join(', ')}`);
  const binaryInfo = await stat(binary);
  return {root, version: version.version, buildId: version.build_id, engineCommit: version.engine_commit, bytes: binaryInfo.size, sourceArchiveSha256: metadata.source_archive_sha256};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySidecar().then(report => {
    console.log(`npm sidecar: PASS (${report.version}, ${report.engineCommit}, ${report.root})`);
  }).catch(error => {
    console.error(`npm sidecar: FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
