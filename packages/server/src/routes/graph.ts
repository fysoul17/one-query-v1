import type { GraphStore } from '@pyx-memory/core';
import { BadRequestError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import { validatePositiveInt } from '../validation.ts';

export function createGraphRoutes(graphStore: GraphStore) {
  return {
    getNodes: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const name = url.searchParams.get('name') ?? undefined;
      const type = url.searchParams.get('type') ?? undefined;
      const limit = validatePositiveInt(url.searchParams.get('limit'), 'limit', 50);

      const nodes = await graphStore.findNodes({
        name,
        type,
        limit: Math.min(100, limit),
      });
      return jsonResponse({ nodes, totalCount: nodes.length });
    },

    getEdges: async (): Promise<Response> => {
      const { nodeCount, edgeCount } = await graphStore.stats();
      return jsonResponse({ stats: { nodeCount, edgeCount } });
    },

    getRelationships: async (req: Request): Promise<Response> => {
      if (!graphStore.getAllEdges) {
        throw new BadRequestError('Graph store does not support bulk edge retrieval');
      }
      const url = new URL(req.url);
      const limit = validatePositiveInt(url.searchParams.get('limit'), 'limit', 200);
      const clamped = Math.min(1000, limit);

      const allEdges = await graphStore.getAllEdges();
      const relationships = allEdges.slice(0, clamped);
      return jsonResponse({ relationships, totalCount: allEdges.length });
    },

    query: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<{ nodeId?: string; depth?: number }>(req);
      if (!body.nodeId) {
        throw new BadRequestError('nodeId is required');
      }
      const depth = Math.min(5, Math.max(1, body.depth ?? 1));
      const result = await graphStore.getNeighbors(body.nodeId, depth);
      return jsonResponse(result);
    },
  };
}
