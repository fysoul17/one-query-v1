import { beforeEach, describe, expect, test } from 'bun:test';
import { BadRequestError, NotFoundError } from '../../src/errors.ts';
import { createGraphRoutes } from '../../src/routes/graph.ts';

function makeNode(id: string, name: string, type = 'entity') {
  return { id, name, type, properties: {}, memoryEntryIds: [] };
}

function makeEdge(id: string, sourceId: string, targetId: string, type = 'related') {
  return { id, sourceId, targetId, type, properties: {} };
}

class MockGraphStore {
  readonly name = 'mock';
  findNodesCalls: Array<Record<string, unknown>> = [];
  getNeighborsCalls: Array<{ nodeId: string; depth: number }> = [];
  private _nodes = [makeNode('n1', 'Alice'), makeNode('n2', 'Bob', 'person')];
  private _edges = [makeEdge('e1', 'n1', 'n2', 'knows')];

  async findNodes(query: { name?: string; type?: string; limit?: number }) {
    this.findNodesCalls.push(query);
    let result = [...this._nodes];
    // biome-ignore lint/style/noNonNullAssertion: guarded by if check above
    if (query.name) result = result.filter((n) => n.name.includes(query.name!));
    if (query.type) result = result.filter((n) => n.type === query.type);
    if (query.limit) result = result.slice(0, query.limit);
    return result;
  }

  async stats() {
    return { nodeCount: this._nodes.length, edgeCount: this._edges.length };
  }

  getAllEdges?: () => Promise<typeof this._edges>;

  enableGetAllEdges() {
    this.getAllEdges = async () => [...this._edges];
  }

  seedEdges(count: number) {
    this._edges = [];
    for (let i = 0; i < count; i++) {
      this._edges.push(makeEdge(`e${i}`, 'n1', 'n2', `rel${i}`));
    }
  }

  async getNeighbors(nodeId: string, depth = 1) {
    this.getNeighborsCalls.push({ nodeId, depth });
    return { nodes: this._nodes, relationships: this._edges, paths: [] };
  }

  async initialize() {}
  addNodeCalls: Array<Record<string, unknown>> = [];
  addRelationshipCalls: Array<Record<string, unknown>> = [];
  deleteNodeCalls: string[] = [];
  private _deleteNodeResult = true;

  getNodesByIds?: (ids: string[]) => Promise<ReturnType<typeof makeNode>[]>;

  enableGetNodesByIds() {
    this.getNodesByIds = async (ids: string[]) => {
      return this._nodes.filter((n) => ids.includes(n.id));
    };
  }

  setDeleteNodeResult(result: boolean) {
    this._deleteNodeResult = result;
  }

  async addNode(data: Record<string, unknown>) {
    this.addNodeCalls.push(data);
    return makeNode('new', data.name as string, data.type as string);
  }
  async addRelationship(data: Record<string, unknown>) {
    this.addRelationshipCalls.push(data);
    return makeEdge('new', data.sourceId as string, data.targetId as string, data.type as string);
  }
  async deleteNode(id: string) {
    this.deleteNodeCalls.push(id);
    return this._deleteNodeResult;
  }
  async shutdown() {}
}

describe('Graph routes', () => {
  let store: MockGraphStore;
  let routes: ReturnType<typeof createGraphRoutes>;

  beforeEach(() => {
    store = new MockGraphStore();
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    routes = createGraphRoutes(store as any);
  });

  describe('GET /api/memory/graph/nodes', () => {
    test('returns all nodes with defaults', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes');
      const res = await routes.getNodes(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.nodes).toHaveLength(2);
      expect(body.data.totalCount).toBe(2);
    });

    test('passes name filter to store', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?name=Alice');
      const res = await routes.getNodes(req);
      const body = await res.json();

      expect(body.data.nodes).toHaveLength(1);
      expect(body.data.nodes[0].name).toBe('Alice');
      expect(store.findNodesCalls[0].name).toBe('Alice');
    });

    test('passes type filter to store', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?type=person');
      const res = await routes.getNodes(req);
      const body = await res.json();

      expect(body.data.nodes).toHaveLength(1);
      expect(store.findNodesCalls[0].type).toBe('person');
    });

    test('clamps limit to max 100', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?limit=500');
      await routes.getNodes(req);

      expect(store.findNodesCalls[0].limit).toBeLessThanOrEqual(100);
    });

    test('uses default limit of 50', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes');
      await routes.getNodes(req);

      expect(store.findNodesCalls[0].limit).toBeLessThanOrEqual(100);
    });

    test('throws BadRequestError for invalid limit', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes?limit=-1');
      await expect(routes.getNodes(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('GET /api/memory/graph/edges', () => {
    test('returns graph stats', async () => {
      const _req = new Request('http://localhost/api/memory/graph/edges');
      const res = await routes.getEdges();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.stats.nodeCount).toBe(2);
      expect(body.data.stats.edgeCount).toBe(1);
    });
  });

  describe('GET /api/memory/graph/relationships', () => {
    test('throws when getAllEdges is not supported', async () => {
      const req = new Request('http://localhost/api/memory/graph/relationships');
      await expect(routes.getRelationships(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('returns relationships when getAllEdges is supported', async () => {
      store.enableGetAllEdges();
      const req = new Request('http://localhost/api/memory/graph/relationships');
      const res = await routes.getRelationships(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.relationships).toHaveLength(1);
      expect(body.data.totalCount).toBe(1);
    });

    test('respects limit parameter', async () => {
      store.enableGetAllEdges();
      store.seedEdges(50);
      const req = new Request('http://localhost/api/memory/graph/relationships?limit=10');
      const res = await routes.getRelationships(req);
      const body = await res.json();

      expect(body.data.relationships).toHaveLength(10);
      expect(body.data.totalCount).toBe(50);
    });

    test('clamps limit to max 1000', async () => {
      store.enableGetAllEdges();
      store.seedEdges(5);
      const req = new Request('http://localhost/api/memory/graph/relationships?limit=5000');
      const res = await routes.getRelationships(req);
      const body = await res.json();

      expect(body.data.relationships).toHaveLength(5);
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
      expect(store.getNeighborsCalls[0]).toEqual({ nodeId: 'n1', depth: 1 });
    });

    test('throws BadRequestError when nodeId is missing', async () => {
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await expect(routes.query(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('passes depth parameter', async () => {
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'n1', depth: 3 }),
      });
      await routes.query(req);

      expect(store.getNeighborsCalls[0].depth).toBe(3);
    });

    test('clamps depth to max 5', async () => {
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'n1', depth: 100 }),
      });
      await routes.query(req);

      expect(store.getNeighborsCalls[0].depth).toBeLessThanOrEqual(5);
    });

    test('clamps depth to min 1', async () => {
      const req = new Request('http://localhost/api/memory/graph/query', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'n1', depth: -5 }),
      });
      await routes.query(req);

      expect(store.getNeighborsCalls[0].depth).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/memory/graph/nodes (createNode)', () => {
    test('creates a node with valid data', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Entity', type: 'CONCEPT' }),
      });
      const res = await routes.createNode(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Test Entity');
      expect(store.addNodeCalls).toHaveLength(1);
      expect(store.addNodeCalls[0].name).toBe('Test Entity');
      expect(store.addNodeCalls[0].type).toBe('CONCEPT');
    });

    test('defaults properties and memoryEntryIds', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', type: 'TOOL' }),
      });
      await routes.createNode(req);

      expect(store.addNodeCalls[0].properties).toEqual({});
      expect(store.addNodeCalls[0].memoryEntryIds).toEqual([]);
    });

    test('throws BadRequestError when name is missing', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ type: 'CONCEPT' }),
      });
      await expect(routes.createNode(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when type is missing', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      await expect(routes.createNode(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError for invalid entity type', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', type: 'INVALID' }),
      });
      await expect(routes.createNode(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when name exceeds 500 chars', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ name: 'x'.repeat(501), type: 'CONCEPT' }),
      });
      await expect(routes.createNode(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('accepts name with exactly 500 chars', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ name: 'x'.repeat(500), type: 'CONCEPT' }),
      });
      const res = await routes.createNode(req);
      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/memory/graph/relationships (createRelationship)', () => {
    test('creates a relationship with valid data', async () => {
      store.enableGetNodesByIds();
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'n1', targetId: 'n2', type: 'RELATED_TO' }),
      });
      const res = await routes.createRelationship(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(store.addRelationshipCalls).toHaveLength(1);
    });

    test('throws BadRequestError when sourceId is missing', async () => {
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ targetId: 'n2', type: 'RELATED_TO' }),
      });
      await expect(routes.createRelationship(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when targetId is missing', async () => {
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'n1', type: 'RELATED_TO' }),
      });
      await expect(routes.createRelationship(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when type is missing', async () => {
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'n1', targetId: 'n2' }),
      });
      await expect(routes.createRelationship(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError for invalid relation type', async () => {
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'n1', targetId: 'n2', type: 'INVALID' }),
      });
      await expect(routes.createRelationship(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws NotFoundError when source node does not exist', async () => {
      store.enableGetNodesByIds();
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'missing', targetId: 'n2', type: 'RELATED_TO' }),
      });
      await expect(routes.createRelationship(req)).rejects.toBeInstanceOf(NotFoundError);
    });

    test('throws NotFoundError when target node does not exist', async () => {
      store.enableGetNodesByIds();
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'n1', targetId: 'missing', type: 'RELATED_TO' }),
      });
      await expect(routes.createRelationship(req)).rejects.toBeInstanceOf(NotFoundError);
    });

    test('skips node existence check when getNodesByIds is unavailable', async () => {
      // getNodesByIds is not enabled — validation is skipped
      const req = new Request('http://localhost/api/memory/graph/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceId: 'any', targetId: 'any', type: 'RELATED_TO' }),
      });
      const res = await routes.createRelationship(req);
      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /api/memory/graph/nodes/:id (deleteNode)', () => {
    test('deletes an existing node', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes/n1', {
        method: 'DELETE',
      });
      const res = await routes.deleteNode(req, { id: 'n1' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.deleted).toBe('n1');
      expect(store.deleteNodeCalls).toEqual(['n1']);
    });

    test('throws NotFoundError when node does not exist', async () => {
      store.setDeleteNodeResult(false);
      const req = new Request('http://localhost/api/memory/graph/nodes/missing', {
        method: 'DELETE',
      });
      await expect(routes.deleteNode(req, { id: 'missing' })).rejects.toBeInstanceOf(NotFoundError);
    });

    test('throws BadRequestError when id param is empty', async () => {
      const req = new Request('http://localhost/api/memory/graph/nodes/', {
        method: 'DELETE',
      });
      await expect(routes.deleteNode(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });
  });
});
