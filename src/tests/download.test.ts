import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {downloadCatalogEntry} from '../download.js';
import type {CatalogEntry} from '../types.js';

const payload = new TextEncoder().encode('hello world!');
const fixture: CatalogEntry = {
  id: 'fixture', profileId: 'fixture', runtime: 'gguf', displayName: 'Fixture', description: 'Fixture',
  repository: 'example/fixture', revision: '0123456789abcdef', licenseName: 'MIT', licenseUrl: 'https://example.test/license',
  memoryClassGiB: 1, diskBytes: payload.byteLength, destinationSlug: 'fixture', featured: true, downloadEnabled: true,
  artifacts: [{name: 'fixture.gguf', bytes: payload.byteLength, sourcePath: 'fixture.gguf'}], capabilities: [],
};

test('interrupts, validates identity, resumes, and atomically completes without hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-download-test.'));
  const firstAbort = new AbortController();
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get('range');
    requests.push(range ?? 'full');
    const start = range ? Number(range.match(/^bytes=(\d+)-$/u)?.[1]) : 0;
    assert.ok(Number.isSafeInteger(start));
    const bytes = payload.slice(start);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (start === 0) {
          controller.enqueue(bytes.slice(0, 5));
          controller.enqueue(bytes.slice(5));
        } else {
          controller.enqueue(bytes);
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: start === 0 ? 200 : 206,
      headers: {etag: '"fixture-v1"', ...(start > 0 ? {'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}`} : {})},
    });
  };
  try {
    await assert.rejects(() => downloadCatalogEntry(fixture, {
      destinationRoot: root,
      signal: firstAbort.signal,
      allowHttpForTests: true,
      sourceUrl: () => 'http://fixture.test/model',
      fetchImpl,
      onProgress(progress) { if (progress.fileCompletedBytes === 5) firstAbort.abort(); },
    }), /abort/i);
    assert.equal((await stat(join(root, 'fixture.partial', 'fixture.gguf'))).size, 5);
    const destination = await downloadCatalogEntry(fixture, {
      destinationRoot: root,
      allowHttpForTests: true,
      sourceUrl: () => 'http://fixture.test/model',
      fetchImpl,
    });
    assert.deepEqual(new Uint8Array(await readFile(join(destination, 'fixture.gguf'))), payload);
    assert.deepEqual(requests, ['full', 'bytes=5-']);
    const receipt = await readFile(join(destination, '.tess-model.json'), 'utf8');
    assert.equal(receipt.includes('sha256'), false);
    await assert.rejects(() => stat(join(root, 'fixture.partial')), /ENOENT/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('rejects plaintext download URLs outside the explicit test seam', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tess-download-https-test.'));
  try {
    await assert.rejects(() => downloadCatalogEntry(fixture, {
      destinationRoot: root,
      sourceUrl: () => 'http://example.test/model',
      fetchImpl: async () => new Response(payload),
    }), /require HTTPS/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
