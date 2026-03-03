import type { GraphNode, GraphTraversalResult, MemoryInterface } from '@autonomy/shared';
import { BadRequestError, NotImplementedError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import { validatePositiveInt } from '../validation.ts';

/** Type guard: does the memory instance have graph query methods? (MemoryClient does) */
function hasGraphMethods(m: MemoryInterface): m is MemoryInterface & {
  graphNodes(): Promise<GraphNode[]>;
  graphEdges(): Promise<{ stats: { nodeCount: number; edgeCount: number } }>;
  graphQuery(query: { nodeId: string; depth?: number }): Promise<GraphTraversalResult>;
} {
  return 'graphNodes' in m && 'graphEdges' in m && 'graphQuery' in m;
}

const MAX_GRAPH_NODES = 100;

export function createGraphRoutes(memory: MemoryInterface) {
  if (!hasGraphMethods(memory)) {
    const unavailable = () => {
      throw new NotImplementedError(
        'Graph operations not available — memory service not connected',
      );
    };
    return {
      getNodes: unavailable,
      getEdges: unavailable,
      query: unavailable,
    };
  }

  return {
    getNodes: async (req: Request): Promise<Response> => {
      // TODO: MemoryClient.graphNodes() should accept { name?, type?, limit? } params
      // to push filtering server-side. The pyx-memory server already supports these query
      // params, but the client doesn't forward them — so we filter client-side for now.
      const nodes = await memory.graphNodes();
      const url = new URL(req.url);
      const name = url.searchParams.get('name')?.toLowerCase();
      const type = url.searchParams.get('type');
      const limit = validatePositiveInt(url.searchParams.get('limit'), 'limit', 50);

      let filtered = nodes;
      if (name) {
        filtered = filtered.filter((n) => n.name.toLowerCase().includes(name));
      }
      if (type) {
        filtered = filtered.filter((n) => n.type === type);
      }
      filtered = filtered.slice(0, Math.min(MAX_GRAPH_NODES, limit));
      return jsonResponse({ nodes: filtered, totalCount: filtered.length });
    },

    getEdges: async (): Promise<Response> => {
      const result = await memory.graphEdges();
      return jsonResponse(result);
    },

    query: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<{ nodeId?: string; depth?: number }>(req);
      if (!body.nodeId) {
        throw new BadRequestError('nodeId is required');
      }
      const depth = Math.min(5, Math.max(1, body.depth ?? 1));
      const result = await memory.graphQuery({ nodeId: body.nodeId, depth });
      return jsonResponse(result);
    },
  };
}
