import {open, mkdir, readFile, rename, stat, statfs, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {CatalogEntry} from './types.js';

export interface DownloadProgress {
  phase: 'preparing' | 'downloading' | 'finalizing' | 'complete';
  completedBytes: number;
  totalBytes: number;
  file?: string;
  fileCompletedBytes?: number;
  fileTotalBytes?: number;
}

export interface DownloadOptions {
  destinationRoot: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  fetchImpl?: typeof fetch;
  allowHttpForTests?: boolean;
  sourceUrl?: (entry: CatalogEntry, sourcePath: string) => string;
}

interface PartialFileRecord {
  name: string;
  bytes: number;
  etag?: string;
}

interface PartialReceipt {
  schemaVersion: 1;
  catalogId: string;
  repository: string;
  revision: string;
  files: PartialFileRecord[];
}

function safeFilename(name: string): void {
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`unsafe catalog artifact name: ${name}`);
  }
}

function defaultSourceUrl(entry: CatalogEntry, sourcePath: string): string {
  const path = sourcePath.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${entry.repository}/resolve/${encodeURIComponent(entry.revision)}/${path}?download=true`;
}

async function loadPartialReceipt(path: string): Promise<PartialReceipt | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as PartialReceipt;
    if (value.schemaVersion !== 1 || !Array.isArray(value.files)) throw new Error('invalid partial receipt');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeReceipt(path: string, receipt: PartialReceipt): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
}

export async function downloadCatalogEntry(
  entry: CatalogEntry,
  options: DownloadOptions,
): Promise<string> {
  if (!entry.downloadEnabled) throw new Error(entry.downloadUnavailableReason ?? 'download is unavailable');
  for (const artifact of entry.artifacts) safeFilename(artifact.name);
  await mkdir(options.destinationRoot, {recursive: true, mode: 0o700});
  const finalDirectory = resolve(options.destinationRoot, entry.destinationSlug);
  const partialDirectory = `${finalDirectory}.partial`;
  try {
    await stat(finalDirectory);
    throw new Error(`download destination already exists: ${finalDirectory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(partialDirectory, {recursive: true, mode: 0o700});
  const receiptPath = join(partialDirectory, '.tess-download.json');
  let receipt = await loadPartialReceipt(receiptPath);
  if (receipt && (receipt.catalogId !== entry.id || receipt.repository !== entry.repository || receipt.revision !== entry.revision)) {
    throw new Error('the resumable partial belongs to a different catalog revision');
  }
  receipt ??= {
    schemaVersion: 1,
    catalogId: entry.id,
    repository: entry.repository,
    revision: entry.revision,
    files: entry.artifacts.map(artifact => ({name: artifact.name, bytes: artifact.bytes})),
  };
  await writeReceipt(receiptPath, receipt);

  const filesystem = await statfs(options.destinationRoot);
  let existingTotal = 0;
  for (const artifact of entry.artifacts) {
    try {
      const info = await stat(join(partialDirectory, artifact.name));
      if (!info.isFile() || info.size > artifact.bytes) throw new Error(`invalid partial file: ${artifact.name}`);
      existingTotal += info.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const required = entry.diskBytes - existingTotal;
  const available = Number(filesystem.bavail) * Number(filesystem.bsize);
  const margin = Math.max(1024 ** 3, Math.ceil(required * 0.02));
  if (available < required + margin) {
    throw new Error(`insufficient free space: need ${required + margin} bytes including safety margin`);
  }
  options.onProgress?.({phase: 'preparing', completedBytes: existingTotal, totalBytes: entry.diskBytes});

  const fetchImpl = options.fetchImpl ?? fetch;
  let completedBeforeFile = 0;
  for (const artifact of entry.artifacts) {
    options.signal?.throwIfAborted();
    const destination = join(partialDirectory, artifact.name);
    let existing = 0;
    try { existing = (await stat(destination)).size; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing === artifact.bytes) {
      completedBeforeFile += existing;
      continue;
    }
    const record = receipt.files.find(item => item.name === artifact.name);
    if (!record || record.bytes !== artifact.bytes) throw new Error(`partial receipt mismatch: ${artifact.name}`);
    const url = (options.sourceUrl ?? defaultSourceUrl)(entry, artifact.sourcePath);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(options.allowHttpForTests && parsed.protocol === 'http:')) {
      throw new Error('model downloads require HTTPS');
    }
    const headers = new Headers();
    if (existing > 0) {
      if (!record.etag) throw new Error(`cannot safely resume ${artifact.name}: response identity is missing`);
      headers.set('Range', `bytes=${existing}-`);
      headers.set('If-Range', record.etag);
    }
    const response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      ...(options.signal ? {signal: options.signal} : {}),
    });
    if (!response.ok || !response.body) throw new Error(`download failed for ${artifact.name}: HTTP ${response.status}`);
    if (new URL(response.url || url).protocol !== parsed.protocol) throw new Error('download redirected to an unexpected protocol');
    if (existing > 0) {
      const range = response.headers.get('content-range');
      if (response.status !== 206 || !range?.startsWith(`bytes ${existing}-`)) {
        throw new Error(`server refused a safe resume for ${artifact.name}`);
      }
    } else if (response.status !== 200) {
      throw new Error(`unexpected response for ${artifact.name}: HTTP ${response.status}`);
    }
    const etag = response.headers.get('etag') ?? undefined;
    if (record.etag && etag && record.etag !== etag) throw new Error(`remote identity changed for ${artifact.name}`);
    if (etag) record.etag = etag;
    await writeReceipt(receiptPath, receipt);
    const handle = await open(destination, existing > 0 ? 'a' : 'w', 0o600);
    let received = existing;
    try {
      const reader = response.body.getReader();
      while (true) {
        options.signal?.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        if (received + chunk.value.byteLength > artifact.bytes) throw new Error(`download exceeded expected size: ${artifact.name}`);
        await handle.write(chunk.value);
        received += chunk.value.byteLength;
        options.onProgress?.({
          phase: 'downloading',
          completedBytes: completedBeforeFile + received,
          totalBytes: entry.diskBytes,
          file: artifact.name,
          fileCompletedBytes: received,
          fileTotalBytes: artifact.bytes,
        });
      }
    } finally {
      await handle.close();
    }
    if (received !== artifact.bytes) throw new Error(`download is truncated: ${artifact.name}`);
    completedBeforeFile += received;
  }

  options.onProgress?.({phase: 'finalizing', completedBytes: entry.diskBytes, totalBytes: entry.diskBytes});
  const completion = {
    schemaVersion: 1,
    catalogId: entry.id,
    repository: entry.repository,
    revision: entry.revision,
    completedAt: new Date().toISOString(),
    artifacts: entry.artifacts.map(artifact => ({name: artifact.name, bytes: artifact.bytes})),
  };
  await writeFile(join(partialDirectory, '.tess-model.json'), `${JSON.stringify(completion, null, 2)}\n`, {mode: 0o600});
  await rename(partialDirectory, finalDirectory);
  options.onProgress?.({phase: 'complete', completedBytes: entry.diskBytes, totalBytes: entry.diskBytes});
  return finalDirectory;
}
