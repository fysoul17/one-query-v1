import type { GraphStore } from '@pyx-memory/core';
import { BadRequestError, NotFoundError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';
import { validateEntityType, validatePositiveInt, validateRelationType } from '../validation.ts';

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

    createNode: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<{
        name?: string;
        type?: string;
        properties?: Record<string, unknown>;
        memoryEntryIds?: string[];
      }>(req);

      if (!body.name || typeof body.name !== 'string') {
        throw new BadRequestError('name is required and must be a string');
      }
      if (body.name.length > 500) {
        throw new BadRequestError('name must be 500 characters or fewer');
      }
      if (!body.type || typeof body.type !== 'string') {
        throw new BadRequestError('type is required');
      }
      validateEntityType(body.type);

      const node = await graphStore.addNode({
        name: body.name,
        type: body.type,
        properties: body.properties ?? {},
        memoryEntryIds: body.memoryEntryIds ?? [],
      });
      return jsonResponse(node, 201);
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: query handler validates many optional fields
    createRelationship: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<{
        sourceId?: string;
        targetId?: string;
        type?: string;
        properties?: Record<string, unknown>;
        memoryEntryId?: string;
      }>(req);

      if (!body.sourceId || typeof body.sourceId !== 'string') {
        throw new BadRequestError('sourceId is required');
      }
      if (!body.targetId || typeof body.targetId !== 'string') {
        throw new BadRequestError('targetId is required');
      }
      if (!body.type || typeof body.type !== 'string') {
        throw new BadRequestError('type is required');
      }
      validateRelationType(body.type);

      // Validate referenced nodes exist (no FK constraints in graph store)
      if (graphStore.getNodesByIds) {
        const nodes = await graphStore.getNodesByIds([body.sourceId, body.targetId]);
        const foundIds = new Set(nodes.map((n) => n.id));
        if (!foundIds.has(body.sourceId)) {
          throw new NotFoundError('Source node not found');
        }
        if (!foundIds.has(body.targetId)) {
          throw new NotFoundError('Target node not found');
        }
      }

      const rel = await graphStore.addRelationship({
        sourceId: body.sourceId,
        targetId: body.targetId,
        type: body.type,
        properties: body.properties ?? {},
        memoryEntryId: body.memoryEntryId,
      });
      return jsonResponse(rel, 201);
    },

    deleteNode: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Node id is required');
      const deleted = await graphStore.deleteNode(id);
      if (!deleted) throw new NotFoundError('Graph node not found');
      return jsonResponse({ deleted: id });
    },
  };
}
