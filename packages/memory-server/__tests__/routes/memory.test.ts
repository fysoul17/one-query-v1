import { describe, expect, test } from 'bun:test';
import {
  type MemoryEntry,
  type MemorySearchResult,
  type MemoryStats,
  MemoryType,
  RAGStrategy,
} from '@autonomy/shared';
import { createMemoryRoutes } from '../../src/routes/memory.ts';

const MOCK_ENTRY: MemoryEntry = {
  id: 'entry-1',
  content: 'Test memory content',
  type: MemoryType.LONG_TERM,
  metadata: { source: 'test' },
  createdAt: new Date().toISOString(),
};

const MOCK_SEARCH_RESULT: MemorySearchResult = {
  entries: [MOCK_ENTRY],
  totalCount: 1,
  strategy: RAGStrategy.NAIVE,
};

const MOCK_STATS: MemoryStats = {
  totalEntries: 10,
  vectorCount: 8,
  storageUsedBytes: 4096,
  recentAccessCount: 5,
};

function mockMemory(overrides?: Partial<Record<string, (...args: unknown[]) => unknown>>) {
  return {
    search: async () => MOCK_SEARCH_RESULT,
    store: async (entry: any) => ({ ...MOCK_ENTRY, ...entry }),
    stats: async () => MOCK_STATS,
    get: async (id: string) => (id === MOCK_ENTRY.id ? MOCK_ENTRY : null),
    delete: async (id: string) => id === MOCK_ENTRY.id,
    clearSession: async () => 3,
    ...overrides,
  } as any;
}

describe('Memory routes', () => {
  describe('GET /api/memory/search', () => {
    test('searches with query parameter', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.search(new Request('http://localhost/api/memory/search?query=test'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.entries).toHaveLength(1);
      expect(body.data.totalCount).toBe(1);
    });

    test('passes limit and type params', async () => {
      let capturedParams: any;
      const routes = createMemoryRoutes(
        mockMemory({
          search: async (params: any) => {
            capturedParams = params;
            return MOCK_SEARCH_RESULT;
          },
        }),
      );

      await routes.search(
        new Request('http://localhost/api/memory/search?query=test&limit=5&type=long-term'),
      );

      expect(capturedParams.query).toBe('test');
      expect(capturedParams.limit).toBe(5);
      expect(capturedParams.type).toBe(MemoryType.LONG_TERM);
    });

    test('passes agentId param', async () => {
      let capturedParams: any;
      const routes = createMemoryRoutes(
        mockMemory({
          search: async (params: any) => {
            capturedParams = params;
            return MOCK_SEARCH_RESULT;
          },
        }),
      );

      await routes.search(
        new Request('http://localhost/api/memory/search?query=test&agentId=agent-1'),
      );

      expect(capturedParams.agentId).toBe('agent-1');
    });

    test('passes strategy param', async () => {
      let capturedParams: any;
      const routes = createMemoryRoutes(
        mockMemory({
          search: async (params: any) => {
            capturedParams = params;
            return MOCK_SEARCH_RESULT;
          },
        }),
      );

      await routes.search(
        new Request('http://localhost/api/memory/search?query=test&strategy=graph'),
      );

      expect(capturedParams.strategy).toBe(RAGStrategy.GRAPH);
    });

    test('throws on missing query', async () => {
      const routes = createMemoryRoutes(mockMemory());
      await expect(
        routes.search(new Request('http://localhost/api/memory/search')),
      ).rejects.toThrow('query parameter is required');
    });

    test('throws on invalid type param', async () => {
      const routes = createMemoryRoutes(mockMemory());
      await expect(
        routes.search(new Request('http://localhost/api/memory/search?query=test&type=invalid')),
      ).rejects.toThrow('Invalid type');
    });

    test('throws on invalid strategy param', async () => {
      const routes = createMemoryRoutes(mockMemory());
      await expect(
        routes.search(
          new Request('http://localhost/api/memory/search?query=test&strategy=invalid'),
        ),
      ).rejects.toThrow('Invalid strategy');
    });
  });

  describe('POST /api/memory/ingest', () => {
    test('stores content in memory', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'Hello world' }),
      });

      const res = await routes.ingest(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.content).toBeDefined();
    });

    test('accepts explicit type field', async () => {
      let storedType: string | undefined;
      const routes = createMemoryRoutes(
        mockMemory({
          store: async (entry: any) => {
            storedType = entry.type;
            return { ...MOCK_ENTRY, ...entry };
          },
        }),
      );

      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'data', type: MemoryType.SHORT_TERM }),
      });

      await routes.ingest(req);
      expect(storedType).toBe(MemoryType.SHORT_TERM);
    });

    test('defaults to long-term type', async () => {
      let storedType: string | undefined;
      const routes = createMemoryRoutes(
        mockMemory({
          store: async (entry: any) => {
            storedType = entry.type;
            return { ...MOCK_ENTRY, ...entry };
          },
        }),
      );

      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'data' }),
      });

      await routes.ingest(req);
      expect(storedType).toBe(MemoryType.LONG_TERM);
    });

    test('throws on missing content', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ type: 'long-term' }),
      });

      await expect(routes.ingest(req)).rejects.toThrow('content is required');
    });

    test('throws on invalid type', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'data', type: 'bad-type' }),
      });

      await expect(routes.ingest(req)).rejects.toThrow('Invalid type');
    });

    test('passes metadata through', async () => {
      let storedMetadata: any;
      const routes = createMemoryRoutes(
        mockMemory({
          store: async (entry: any) => {
            storedMetadata = entry.metadata;
            return { ...MOCK_ENTRY, ...entry };
          },
        }),
      );

      const req = new Request('http://localhost/api/memory/ingest', {
        method: 'POST',
        body: JSON.stringify({ content: 'data', metadata: { tag: 'important' } }),
      });

      await routes.ingest(req);
      expect(storedMetadata).toEqual({ tag: 'important' });
    });
  });

  describe('GET /api/memory/stats', () => {
    test('returns memory statistics', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.stats();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.totalEntries).toBe(10);
      expect(body.data.vectorCount).toBe(8);
      expect(body.data.storageUsedBytes).toBe(4096);
    });
  });

  describe('GET /api/memory/entries', () => {
    test('returns paginated entries', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.listEntries(new Request('http://localhost/api/memory/entries'));
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.page).toBe(1);
      expect(body.data.limit).toBe(20);
      expect(body.data.entries).toBeDefined();
    });

    test('accepts page and limit params', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.listEntries(
        new Request('http://localhost/api/memory/entries?page=2&limit=5'),
      );
      const body = await res.json();

      expect(body.data.page).toBe(2);
      expect(body.data.limit).toBe(5);
    });

    test('clamps limit to max 100', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.listEntries(
        new Request('http://localhost/api/memory/entries?limit=500'),
      );
      const body = await res.json();
      expect(body.data.limit).toBe(100);
    });

    test('clamps limit to min 1', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.listEntries(
        new Request('http://localhost/api/memory/entries?limit=0'),
      );
      const body = await res.json();
      expect(body.data.limit).toBe(1);
    });

    test('clamps page to min 1', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.listEntries(
        new Request('http://localhost/api/memory/entries?page=-1'),
      );
      const body = await res.json();
      expect(body.data.page).toBe(1);
    });
  });

  describe('GET /api/memory/entries/:id', () => {
    test('returns a single entry', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.getEntry(
        new Request('http://localhost/api/memory/entries/entry-1'),
        { id: 'entry-1' },
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.id).toBe('entry-1');
      expect(body.data.content).toBe('Test memory content');
    });

    test('throws 404 for missing entry', async () => {
      const routes = createMemoryRoutes(mockMemory());
      await expect(
        routes.getEntry(new Request('http://localhost/api/memory/entries/missing'), {
          id: 'missing',
        }),
      ).rejects.toThrow('not found');
    });

    test('throws on missing id param', async () => {
      const routes = createMemoryRoutes(mockMemory());
      await expect(
        routes.getEntry(new Request('http://localhost/api/memory/entries/'), {}),
      ).rejects.toThrow('id parameter is required');
    });
  });

  describe('DELETE /api/memory/entries/:id', () => {
    test('deletes an entry', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.deleteEntry(
        new Request('http://localhost/api/memory/entries/entry-1', { method: 'DELETE' }),
        { id: 'entry-1' },
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe('entry-1');
    });

    test('throws 404 for non-existent entry', async () => {
      const routes = createMemoryRoutes(mockMemory());
      await expect(
        routes.deleteEntry(
          new Request('http://localhost/api/memory/entries/missing', { method: 'DELETE' }),
          { id: 'missing' },
        ),
      ).rejects.toThrow('not found');
    });
  });

  describe('DELETE /api/memory/sessions/:sessionId', () => {
    test('clears a session', async () => {
      const routes = createMemoryRoutes(mockMemory());
      const res = await routes.clearSession(
        new Request('http://localhost/api/memory/sessions/sess-1', { method: 'DELETE' }),
        { sessionId: 'sess-1' },
      );
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.cleared).toBe(3);
      expect(body.data.sessionId).toBe('sess-1');
    });

    test('throws on missing sessionId', async () => {
      const routes = createMemoryRoutes(mockMemory());
      await expect(
        routes.clearSession(
          new Request('http://localhost/api/memory/sessions/', { method: 'DELETE' }),
          {},
        ),
      ).rejects.toThrow('sessionId parameter is required');
    });
  });
});
