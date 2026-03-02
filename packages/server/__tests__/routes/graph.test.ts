import { beforeEach, describe, expect, test } from 'bun:test';
import type { MemoryInterface } from '@pyx-memory/client';
import { BadRequestError, NotImplementedError } from '../../src/errors.ts';
import { createGraphRoutes } from '../../src/routes/graph.ts';

function makeNode(id: string, name: string, type = 'entity') {
  return { id, name, type, properties: {}, memoryEntryIds: [] };
}

/** Mock that implements graphNodes/graphEdges/graphQuery like MemoryClient. */
class MockMemoryWithGraph {
  private _nodes = [makeNode('n1', 'Alice'), makeNode('n2', 'Bob', 'person')];

  async graphNodes() {
    return [...this._nodes];
  }

  async graphEdges() {
    return { stats: { nodeCount: this._nodes.length, edgeCount: 1 } };
  }

  async graphQuery(_query: { nodeId: string; depth?: number }) {
    return {
      nodes: this._nodes,
      relationships: [{ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'knows', properties: {} }],
      paths: [],
    };
  }

  // MemoryInterface methods (stubs)
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

/** Mock without graph methods — simulates DisabledMemory. */
class MockMemoryNoGraph {
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

describe('Graph routes — memory with graph methods (MemoryClient)', () => {
  let memory: MockMemoryWithGraph;
  let routes: ReturnType<typeof createGraphRoutes>;

  beforeEach(() => {
    memory = new MockMemoryWithGraph();
    routes = createGraphRoutes(memory as unknown as MemoryInterface);
  });

  describe('GET /api/memory/graph/nodes', () => {
    test('returns all nodes', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes');
      const res = await routes.getNodes(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.nodes).toHaveLength(2);
      expect(body.data.totalCount).toBe(2);
    });

    test('filters by name (case-insensitive)', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?name=alice');
      const res = await routes.getNodes(req);
      const body = await res.json();

      expect(body.data.nodes).toHaveLength(1);
      expect(body.data.nodes[0].name).toBe('Alice');
    });

    test('filters by type', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?type=person');
      const res = await routes.getNodes(req);
      const body = await res.json();

      expect(body.data.nodes).toHaveLength(1);
      expect(body.data.nodes[0].name).toBe('Bob');
    });

    test('respects limit parameter', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?limit=1');
      const res = await routes.getNodes(req);
      const body = await res.json();

      expect(body.data.nodes).toHaveLength(1);
    });

    test('throws BadRequestError for invalid limit', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?limit=-1');
      await expect(routes.getNodes(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('GET /api/memory/graph/edges', () => {
    test('returns graph stats', async () => {
      const res = await routes.getEdges();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.stats.nodeCount).toBe(2);
      expect(body.data.stats.edgeCount).toBe(1);
    });
  });

  describe('POST /api/memory/graph/query', () => {
    test('returns traversal result for valid nodeId', async () => {
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'n1' }),
      });
      const res = await routes.query(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.nodes).toHaveLength(2);
    });

    test('throws BadRequestError when nodeId is missing', async () => {
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await expect(routes.query(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('clamps depth to max 5', async () => {
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'n1', depth: 100 }),
      });
      // Should not throw — depth is clamped server-side
      const res = await routes.query(req);
      expect(res.status).toBe(200);
    });
  });
});

describe('Graph routes — memory without graph methods (DisabledMemory)', () => {
  let routes: ReturnType<typeof createGraphRoutes>;

  beforeEach(() => {
    const memory = new MockMemoryNoGraph();
    routes = createGraphRoutes(memory as unknown as MemoryInterface);
  });

  test('all routes throw NotImplementedError', () => {
    expect(() => routes.getNodes(new Request('http://localhost'))).toThrow(NotImplementedError);
    expect(() => routes.getEdges()).toThrow(NotImplementedError);
    expect(() => routes.query(new Request('http://localhost'))).toThrow(NotImplementedError);
  });
});
