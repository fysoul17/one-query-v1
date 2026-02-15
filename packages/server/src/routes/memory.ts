import type { Memory } from '@autonomy/memory';
import { MemoryType, type MemoryIngestRequest, type MemorySearchParams, type MemoryType as MemoryTypeValue } from '@autonomy/shared';
import { BadRequestError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';

export function createMemoryRoutes(memory: Memory) {
  return {
    search: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const query = url.searchParams.get('query');
      if (!query) throw new BadRequestError('query parameter is required');

      const params: MemorySearchParams = {
        query,
        limit: url.searchParams.has('limit')
          ? parseInt(url.searchParams.get('limit')!, 10)
          : undefined,
        type: url.searchParams.get('type') as MemoryTypeValue | undefined,
        agentId: url.searchParams.get('agentId') ?? undefined,
      };

      const results = await memory.search(params);
      return jsonResponse(results);
    },

    ingest: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<MemoryIngestRequest>(req);

      if (!body.content) {
        throw new BadRequestError('content is required');
      }

      const entry = await memory.store({
        content: body.content,
        type: MemoryType.LONG_TERM,
        metadata: body.metadata ?? {},
      });

      return jsonResponse(entry, 201);
    },

    stats: async (): Promise<Response> => {
      const stats = await memory.stats();
      return jsonResponse(stats);
    },
  };
}
