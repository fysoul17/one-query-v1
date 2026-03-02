import { type MemoryIngestRequest, type MemorySearchParams, MemoryType } from '@autonomy/shared';
import type { IngestionResult, MemoryInterface } from '@pyx-memory/client';
import { BadRequestError, NotFoundError, NotImplementedError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';
import { validateMemoryType, validatePositiveInt, validateRAGStrategy } from '../validation.ts';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/** Type guard: does the memory instance support file ingestion? (MemoryClient does) */
function hasIngestFile(
  m: MemoryInterface,
): m is MemoryInterface & { ingestFile(file: File): Promise<IngestionResult> } {
  return 'ingestFile' in m;
}

export function createMemoryRoutes(memory: MemoryInterface) {
  return {
    search: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const query = url.searchParams.get('query');
      if (!query) throw new BadRequestError('query parameter is required');

      // Note: enableHyDE and enableRerank are not forwarded by the pyx-memory
      // HTTP API in sidecar mode — omitted to avoid a misleading API contract.
      const params: MemorySearchParams = {
        query,
        limit: validatePositiveInt(url.searchParams.get('limit'), 'limit', 10),
        type: validateMemoryType(url.searchParams.get('type')),
        agentId: url.searchParams.get('agentId') ?? undefined,
        strategy: validateRAGStrategy(url.searchParams.get('strategy')),
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
        type: validateMemoryType(body.type) ?? MemoryType.LONG_TERM,
        metadata: body.metadata ?? {},
      });

      return jsonResponse(entry, 201);
    },

    stats: async (_req: Request): Promise<Response> => {
      const stats = await memory.stats();
      return jsonResponse(stats);
    },

    entries: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const page = Math.min(100, validatePositiveInt(url.searchParams.get('page'), 'page', 1));
      const limit = Math.min(100, validatePositiveInt(url.searchParams.get('limit'), 'limit', 20));
      const type = validateMemoryType(url.searchParams.get('type'));
      const agentId = url.searchParams.get('agentId') ?? undefined;

      const result = await memory.list({ page, limit, type, agentId });

      return jsonResponse({
        entries: result.entries,
        page: result.page,
        limit: result.limit,
        totalCount: result.totalCount,
      });
    },

    getEntry: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Entry id is required');
      const entry = await memory.get(id);
      if (!entry) throw new NotFoundError(`Memory entry "${id}" not found`);
      return jsonResponse(entry);
    },

    deleteEntry: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Entry id is required');
      const deleted = await memory.delete(id);
      if (!deleted) throw new NotFoundError(`Memory entry "${id}" not found`);
      return jsonResponse({ deleted: id });
    },

    clearSession: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { sessionId } = params;
      if (!sessionId) throw new BadRequestError('sessionId is required');
      const count = await memory.clearSession(sessionId);
      return jsonResponse({ cleared: count });
    },

    ingestFile: async (req: Request): Promise<Response> => {
      if (!hasIngestFile(memory)) {
        throw new NotImplementedError(
          'File ingestion not available — memory service not connected',
        );
      }

      const contentType = req.headers.get('content-type') ?? '';
      if (!contentType.includes('multipart/form-data')) {
        throw new BadRequestError('Content-Type must be multipart/form-data');
      }

      const formData = await req.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        throw new BadRequestError('Missing "file" field in form data');
      }

      if (file.size === 0) {
        throw new BadRequestError('File is empty');
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new BadRequestError(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
      }

      const result = await memory.ingestFile(file);

      return jsonResponse(
        {
          filename: result.filename,
          chunks: result.chunks,
          totalCharacters: result.totalCharacters,
        },
        201,
      );
    },
  };
}
