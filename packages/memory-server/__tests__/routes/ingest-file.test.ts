import { describe, expect, test } from 'bun:test';
import { createFileIngestRoute } from '../../src/routes/ingest-file.ts';

function mockMemory() {
  return {
    store: async (entry: any) => ({
      id: 'chunk-1',
      content: entry.content,
      type: entry.type,
      metadata: entry.metadata ?? {},
      createdAt: new Date().toISOString(),
    }),
  } as any;
}

function makeFormDataRequest(file: File): Request {
  const formData = new FormData();
  formData.append('file', file);
  return new Request('http://localhost/api/memory/ingest/file', {
    method: 'POST',
    body: formData,
  });
}

describe('File ingest route', () => {
  test('rejects non-multipart requests', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const req = new Request('http://localhost/api/memory/ingest/file', {
      method: 'POST',
      body: 'plain text',
      headers: { 'content-type': 'text/plain' },
    });

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain('multipart/form-data');
  });

  test('rejects when file field is missing', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const formData = new FormData();
    formData.append('other', 'value');
    const req = new Request('http://localhost/api/memory/ingest/file', {
      method: 'POST',
      body: formData,
    });

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain('Missing "file" field');
  });

  test('rejects empty files', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const file = new File([], 'empty.txt', { type: 'text/plain' });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain('empty');
  });

  test('rejects unsupported file types', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const file = new File(['binary'], 'payload.exe', { type: 'application/octet-stream' });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain('Unsupported file type');
  });

  test('rejects files exceeding size limit', async () => {
    const handler = createFileIngestRoute(mockMemory());
    // Create a file slightly over 50MB
    const bigContent = new Uint8Array(50 * 1024 * 1024 + 1);
    const file = new File([bigContent], 'big.txt', { type: 'text/plain' });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain('too large');
  });

  test('accepts valid .txt file', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const file = new File(['Hello, this is a test document.'], 'test.txt', {
      type: 'text/plain',
    });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.filename).toBe('test.txt');
    expect(body.data.chunks).toBeGreaterThanOrEqual(1);
  });

  test('accepts valid .md file', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const file = new File(['# Header\n\nSome markdown content.'], 'readme.md', {
      type: 'text/markdown',
    });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.filename).toBe('readme.md');
  });

  test('accepts valid .csv file', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const file = new File(['name,value\nfoo,1\nbar,2'], 'data.csv', {
      type: 'text/csv',
    });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.filename).toBe('data.csv');
  });

  test('sanitizes path traversal in filename', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const file = new File(['content'], '../../../etc/passwd.txt', { type: 'text/plain' });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    // Should strip path components, keeping only the basename
    expect(body.success).toBe(true);
    expect(body.data.filename).not.toContain('..');
  });

  test('rejects files starting with dot', async () => {
    const handler = createFileIngestRoute(mockMemory());
    const file = new File(['content'], '.hidden.txt', { type: 'text/plain' });
    const req = makeFormDataRequest(file);

    const res = await handler(req, {});
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid filename');
  });
});
