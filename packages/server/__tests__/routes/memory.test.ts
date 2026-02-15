import { beforeEach, describe, expect, test } from 'bun:test';
import type { Memory } from '@autonomy/memory';
import { RAGStrategy } from '@autonomy/shared';
import { BadRequestError } from '../../src/errors.ts';
import { createMemoryRoutes } from '../../src/routes/memory.ts';

interface MockStoreInput {
  content: string;
  type: string;
  metadata: Record<string, unknown>;
}

class MockMemory {
  storeCalls: MockStoreInput[] = [];
  searchCalls: Array<Record<string, unknown>> = [];

  async search(params: Record<string, unknown>) {
    this.searchCalls.push(params);
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

  async stats() {
    return { totalEntries: 5, storageUsedBytes: 2048, vectorCount: 3, recentAccessCount: 2 };
  }
}

describe('Memory routes', () => {
  let memory: MockMemory;
  let routes: ReturnType<typeof createMemoryRoutes>;

  beforeEach(() => {
    memory = new MockMemory();
    routes = createMemoryRoutes(memory as unknown as Memory);
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

    test('throws BadRequestError when content is missing', async () => {
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ metadata: {} }),
      });

      await expect(routes.ingest(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('GET /api/memory/stats', () => {
    test('returns memory statistics', async () => {
      const res = await routes.stats();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.totalEntries).toBe(5);
      expect(body.data.vectorCount).toBe(3);
    });
  });
});
