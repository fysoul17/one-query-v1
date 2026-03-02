import { beforeEach, describe, expect, test } from 'bun:test';
import type { MemoryInterface } from '@pyx-memory/client';
import { BadRequestError, NotImplementedError } from '../../src/errors.ts';
import { createMemoryRoutes } from '../../src/routes/memory.ts';

/** Mock that simulates MemoryClient with ingestFile support. */
class MockMemoryWithIngest {
  ingestFileCalls: File[] = [];

  async ingestFile(file: File) {
    this.ingestFileCalls.push(file);
    return {
      filename: file.name,
      chunks: 1,
      totalCharacters: file.size,
    };
  }

  // MemoryInterface stubs
  async initialize() {}
  async store(entry: { content: string; type: string }) {
    return {
      id: '1',
      content: entry.content,
      type: entry.type,
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }
  async search() {
    return { entries: [], totalCount: 0, strategy: 'naive' as const };
  }
  async list() {
    return { entries: [], totalCount: 0, page: 1, limit: 20 };
  }
  async get() {
    return null;
  }
  async delete() {
    return false;
  }
  async clearSession() {
    return 0;
  }
  async stats() {
    return { totalEntries: 0, storageUsedBytes: 0, vectorCount: 0, recentAccessCount: 0 };
  }
  async shutdown() {}
}

/** Mock without ingestFile — simulates DisabledMemory. */
class MockMemoryNoIngest {
  async initialize() {}
  async store(entry: { content: string; type: string }) {
    return {
      id: '',
      content: entry.content,
      type: entry.type,
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }
  async search() {
    return { entries: [], totalCount: 0, strategy: 'naive' as const };
  }
  async list() {
    return { entries: [], totalCount: 0, page: 1, limit: 20 };
  }
  async get() {
    return null;
  }
  async delete() {
    return false;
  }
  async clearSession() {
    return 0;
  }
  async stats() {
    return { totalEntries: 0, storageUsedBytes: 0, vectorCount: 0, recentAccessCount: 0 };
  }
  async shutdown() {}
}

function makeFileRequest(filename: string, content: string): Request {
  const formData = new FormData();
  const blob = new Blob([content], { type: 'text/plain' });
  formData.append('file', new File([blob], filename));

  return new Request('http://localhost/api/memory/ingest/file', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/memory/ingest/file — with MemoryClient', () => {
  let memory: MockMemoryWithIngest;
  let routes: ReturnType<typeof createMemoryRoutes>;

  beforeEach(() => {
    memory = new MockMemoryWithIngest();
    routes = createMemoryRoutes(memory as unknown as MemoryInterface);
  });

  test('ingests a valid file', async () => {
    const req = makeFileRequest('test.txt', 'Hello world, this is test content.');
    const res = await routes.ingestFile(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.filename).toBe('test.txt');
    expect(body.data.chunks).toBeGreaterThanOrEqual(1);
    expect(body.data.totalCharacters).toBeGreaterThan(0);
  });

  test('passes file to memory.ingestFile', async () => {
    const req = makeFileRequest('notes.txt', 'Some content.');
    await routes.ingestFile(req);

    expect(memory.ingestFileCalls).toHaveLength(1);
    expect(memory.ingestFileCalls[0].name).toBe('notes.txt');
  });

  test('rejects empty file', async () => {
    const req = makeFileRequest('empty.txt', '');
    await expect(routes.ingestFile(req)).rejects.toBeInstanceOf(BadRequestError);
  });

  test('rejects missing file field', async () => {
    const formData = new FormData();
    formData.append('notfile', 'oops');
    const req = new Request('http://localhost/api/memory/ingest/file', {
      method: 'POST',
      body: formData,
    });
    await expect(routes.ingestFile(req)).rejects.toBeInstanceOf(BadRequestError);
  });

  test('rejects non-multipart request', async () => {
    const req = new Request('http://localhost/api/memory/ingest/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'nope' }),
    });
    await expect(routes.ingestFile(req)).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('POST /api/memory/ingest/file — without MemoryClient (DisabledMemory)', () => {
  let routes: ReturnType<typeof createMemoryRoutes>;

  beforeEach(() => {
    const memory = new MockMemoryNoIngest();
    routes = createMemoryRoutes(memory as unknown as MemoryInterface);
  });

  test('throws NotImplementedError when memory has no ingestFile', async () => {
    const req = makeFileRequest('test.txt', 'content');
    await expect(routes.ingestFile(req)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
