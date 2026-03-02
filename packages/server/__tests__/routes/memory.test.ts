import { beforeEach, describe, expect, test } from 'bun:test';
import { RAGStrategy } from '@autonomy/shared';
import type { MemoryInterface } from '@pyx-memory/client';
import { BadRequestError, NotFoundError } from '../../src/errors.ts';
import { createMemoryRoutes } from '../../src/routes/memory.ts';

interface MockStoreInput {
  content: string;
  type: string;
  metadata: Record<string, unknown>;
}

function makeEntry(id: string, content: string) {
  return {
    id,
    content,
    type: 'long-term' as const,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

class MockMemory {
  storeCalls: MockStoreInput[] = [];
  searchCalls: Array<Record<string, unknown>> = [];
  entries: Map<string, ReturnType<typeof makeEntry>> = new Map();

  /** Seed N entries into the mock store for pagination/get/delete tests. */
  seed(count = 5) {
    for (let i = 1; i <= count; i++) {
      const entry = makeEntry(`e${i}`, `content ${i}`);
      this.entries.set(entry.id, entry);
    }
  }

  async search(params: Record<string, unknown>) {
    this.searchCalls.push(params);
    if (this.entries.size > 0) {
      const limit = (params.limit as number) ?? 10;
      const all = [...this.entries.values()];
      return {
        entries: all.slice(0, limit),
        totalCount: all.length,
        strategy: RAGStrategy.NAIVE,
      };
    }
    return {
      entries: [
        {
          id: '1',
          content: 'test result',
          type: 'long-term',
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ],
      totalCount: 1,
      strategy: RAGStrategy.NAIVE,
    };
  }

  async store(entry: MockStoreInput) {
    this.storeCalls.push(entry);
    return {
      id: 'mem-1',
      content: entry.content,
      type: entry.type,
      metadata: entry.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
  }

  async get(id: string) {
    return this.entries.get(id) ?? null;
  }

  async delete(id: string) {
    return this.entries.delete(id);
  }

  clearSessionCalls: string[] = [];

  async clearSession(sessionId: string) {
    this.clearSessionCalls.push(sessionId);
    return 3;
  }

  async list(params: { page?: number; limit?: number; type?: string; agentId?: string } = {}) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const all = [...this.entries.values()];
    const offset = (page - 1) * limit;
    const entries = all.slice(offset, offset + limit);
    return { entries, totalCount: all.length, page, limit };
  }

  async stats() {
    return { totalEntries: 5, storageUsedBytes: 2048, vectorCount: 3, recentAccessCount: 2 };
  }
}

describe('Memory routes', () => {
  let memory: MockMemory;
  let routes: ReturnType<typeof createMemoryRoutes>;

  beforeEach(() => {
    memory = new MockMemory();
    routes = createMemoryRoutes(memory as unknown as MemoryInterface);
  });

  describe('GET /api/memory/search', () => {
    test('searches with query parameter', async () => {
      const req = new Request('http://localhost/api/memory/search?query=hello');
      const res = await routes.search(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.entries.length).toBe(1);
      expect(memory.searchCalls[0].query).toBe('hello');
    });

    test('passes limit and type params', async () => {
      const req = new Request(
        'http://localhost/api/memory/search?query=test&limit=10&type=long-term&agentId=a1',
      );
      await routes.search(req);

      expect(memory.searchCalls[0].limit).toBe(10);
      expect(memory.searchCalls[0].type).toBe('long-term');
      expect(memory.searchCalls[0].agentId).toBe('a1');
    });

    test('throws BadRequestError when query is missing', async () => {
      const req = new Request('http://localhost/api/memory/search');
      await expect(routes.search(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('passes strategy param to search', async () => {
      const req = new Request('http://localhost/api/memory/search?query=test&strategy=hybrid');
      await routes.search(req);
      expect(memory.searchCalls[0].strategy).toBe('hybrid');
    });
  });

  describe('POST /api/memory/ingest', () => {
    test('stores content in memory', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'Some important info', metadata: { source: 'api' } }),
      });

      const res = await routes.ingest(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(memory.storeCalls[0].content).toBe('Some important info');
      expect(memory.storeCalls[0].type).toBe('long-term');
    });

    test('accepts explicit type field', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'Session data', type: 'short-term' }),
      });

      const res = await routes.ingest(req);
      expect(res.status).toBe(201);
      expect(memory.storeCalls[0].type).toBe('short-term');
    });

    test('throws BadRequestError for invalid type', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'test', type: 'invalid-type' }),
      });

      await expect(routes.ingest(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when content is missing', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ metadata: {} }),
      });

      await expect(routes.ingest(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('accepts working memory type', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'Working data', type: 'working' }),
      });

      const res = await routes.ingest(req);
      expect(res.status).toBe(201);
      expect(memory.storeCalls[0].type).toBe('working');
    });

    test('accepts episodic memory type', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'Event record', type: 'episodic' }),
      });

      const res = await routes.ingest(req);
      expect(res.status).toBe(201);
      expect(memory.storeCalls[0].type).toBe('episodic');
    });

    test('accepts summary memory type', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'Session summary', type: 'summary' }),
      });

      const res = await routes.ingest(req);
      expect(res.status).toBe(201);
      expect(memory.storeCalls[0].type).toBe('summary');
    });
  });

  describe('GET /api/memory/search', () => {
    test('throws BadRequestError for invalid type param', async () => {
      const req = new Request('http://localhost/api/memory/search?query=test&type=bogus');
      await expect(routes.search(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('GET /api/memory/stats', () => {
    test('returns memory statistics', async () => {
      const res = await routes.stats(new Request('http://localhost/api/memory/stats'));
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.totalEntries).toBe(5);
      expect(body.data.vectorCount).toBe(3);
    });
  });

  describe('GET /api/memory/entries', () => {
    test('returns entries with default pagination', async () => {
      memory.seed(5);
      const req = new Request('http://localhost/api/memory/entries');
      const res = await routes.entries(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.page).toBe(1);
      expect(body.data.limit).toBe(20);
      expect(body.data.entries.length).toBe(5);
      expect(body.data.totalCount).toBe(5);
    });

    test('page=2 with limit=2 returns different slice', async () => {
      memory.seed(5);
      const req = new Request('http://localhost/api/memory/entries?page=2&limit=2');
      const res = await routes.entries(req);
      const body = await res.json();

      expect(body.data.page).toBe(2);
      expect(body.data.limit).toBe(2);
      // page=2 limit=2 means slice [2,4) from results
      expect(body.data.entries.length).toBe(2);
      expect(body.data.entries[0].id).toBe('e3');
    });

    test('throws BadRequestError for invalid page', async () => {
      const req = new Request('http://localhost/api/memory/entries?page=abc');
      await expect(routes.entries(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError for invalid limit', async () => {
      const req = new Request('http://localhost/api/memory/entries?limit=-1');
      await expect(routes.entries(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('GET /api/memory/:id (getEntry)', () => {
    test('returns entry by id', async () => {
      memory.seed(5);
      const req = new Request('http://localhost/api/memory/e1');
      const res = await routes.getEntry(req, { id: 'e1' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.id).toBe('e1');
      expect(body.data.content).toBe('content 1');
    });

    test('throws NotFoundError for missing entry', async () => {
      const req = new Request('http://localhost/api/memory/nope');
      await expect(routes.getEntry(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });

    test('throws BadRequestError when id is missing', async () => {
      const req = new Request('http://localhost/api/memory/');
      await expect(routes.getEntry(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('DELETE /api/memory/:id (deleteEntry)', () => {
    test('deletes entry by id', async () => {
      memory.seed(5);
      const req = new Request('http://localhost/api/memory/e1', { method: 'DELETE' });
      const res = await routes.deleteEntry(req, { id: 'e1' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe('e1');
    });

    test('throws NotFoundError for missing entry', async () => {
      const req = new Request('http://localhost/api/memory/nope', { method: 'DELETE' });
      await expect(routes.deleteEntry(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });

    test('throws BadRequestError when id is missing', async () => {
      const req = new Request('http://localhost/api/memory/', { method: 'DELETE' });
      await expect(routes.deleteEntry(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('search — invalid strategy', () => {
    test('throws BadRequestError for invalid strategy value', async () => {
      const req = new Request('http://localhost/api/memory/search?query=test&strategy=invalid');
      await expect(routes.search(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('DELETE /api/memory/sessions/:sessionId (clearSession)', () => {
    test('clears session and returns count', async () => {
      const req = new Request('http://localhost/api/memory/sessions/sess-1', {
        method: 'DELETE',
      });
      const res = await routes.clearSession(req, { sessionId: 'sess-1' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.cleared).toBe(3);
      expect(memory.clearSessionCalls).toContain('sess-1');
    });

    test('throws BadRequestError when sessionId is missing', async () => {
      const req = new Request('http://localhost/api/memory/sessions/', {
        method: 'DELETE',
      });
      await expect(routes.clearSession(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });
  });
});
