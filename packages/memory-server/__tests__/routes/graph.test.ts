import { describe, expect, test } from 'bun:test';
import type { GraphNode, GraphTraversalResult } from '@autonomy/shared';
import { createGraphRoutes } from '../../src/routes/graph.ts';

const MOCK_NODES: GraphNode[] = [
  {
    id: 'node-1',
    name: 'Entity A',
    type: 'concept',
    properties: {},
    memoryEntryIds: ['entry-1'],
  },
  {
    id: 'node-2',
    name: 'Entity B',
    type: 'person',
    properties: {},
    memoryEntryIds: ['entry-2'],
  },
];

const MOCK_TRAVERSAL: GraphTraversalResult = {
  nodes: MOCK_NODES,
  relationships: [
    {
      id: 'rel-1',
      sourceId: 'node-1',
      targetId: 'node-2',
      type: 'related_to',
      properties: {},
    },
  ],
  paths: [{ nodeIds: ['node-1', 'node-2'], relationshipIds: ['rel-1'] }],
};

function mockGraphStore(overrides?: Partial<Record<string, (...args: unknown[]) => unknown>>) {
  return {
    findNodes: async () => MOCK_NODES,
    stats: async () => ({ nodeCount: 10, edgeCount: 15 }),
    getNeighbors: async () => MOCK_TRAVERSAL,
    ...overrides,
  } as any;
}

describe('Graph routes', () => {
  describe('GET /api/memory/graph/nodes', () => {
    test('returns nodes', async () => {
      const routes = createGraphRoutes(mockGraphStore());
      const res = await routes.getNodes(new Request('http://localhost/api/memory/graph/nodes'));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.nodes).toHaveLength(2);
      expect(body.data.totalCount).toBe(2);
    });

    test('passes filter params to findNodes', async () => {
      let capturedQuery: any;
      const routes = createGraphRoutes(
        mockGraphStore({
          findNodes: async (query: any) => {
            capturedQuery = query;
            return [];
          },
        }),
      );

      await routes.getNodes(
        new Request('http://localhost/api/memory/graph/nodes?name=Entity&type=concept&limit=10'),
      );

      expect(capturedQuery.name).toBe('Entity');
      expect(capturedQuery.type).toBe('concept');
      expect(capturedQuery.limit).toBe(10);
    });

    test('defaults limit to 50', async () => {
      let capturedQuery: any;
      const routes = createGraphRoutes(
        mockGraphStore({
          findNodes: async (query: any) => {
            capturedQuery = query;
            return [];
          },
        }),
      );

      await routes.getNodes(new Request('http://localhost/api/memory/graph/nodes'));
      expect(capturedQuery.limit).toBe(50);
    });
  });

  describe('GET /api/memory/graph/edges', () => {
    test('returns edge stats', async () => {
      const routes = createGraphRoutes(mockGraphStore());
      const res = await routes.getEdges();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.stats.nodeCount).toBe(10);
      expect(body.data.stats.edgeCount).toBe(15);
    });
  });

  describe('POST /api/memory/graph/query', () => {
    test('queries neighbors by nodeId', async () => {
      const routes = createGraphRoutes(mockGraphStore());
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'node-1' }),
      });

      const res = await routes.query(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.nodes).toHaveLength(2);
      expect(body.data.relationships).toHaveLength(1);
    });

    test('passes depth parameter', async () => {
      let capturedDepth: number | undefined;
      const routes = createGraphRoutes(
        mockGraphStore({
          getNeighbors: async (_nodeId: string, depth: number) => {
            capturedDepth = depth;
            return MOCK_TRAVERSAL;
          },
        }),
      );

      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'node-1', depth: 3 }),
      });

      await routes.query(req);
      expect(capturedDepth).toBe(3);
    });

    test('defaults depth to 1', async () => {
      let capturedDepth: number | undefined;
      const routes = createGraphRoutes(
        mockGraphStore({
          getNeighbors: async (_nodeId: string, depth: number) => {
            capturedDepth = depth;
            return MOCK_TRAVERSAL;
          },
        }),
      );

      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'node-1' }),
      });

      await routes.query(req);
      expect(capturedDepth).toBe(1);
    });

    test('returns 400 when nodeId is missing', async () => {
      const routes = createGraphRoutes(mockGraphStore());
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await routes.query(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('nodeId is required');
    });

    test('returns 400 on invalid JSON body', async () => {
      const routes = createGraphRoutes(mockGraphStore());
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: '{{invalid',
        headers: { 'content-type': 'application/json' },
      });

      const res = await routes.query(req);
      expect(res.status).toBe(400);
    });
  });
});
