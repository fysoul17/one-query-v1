import type { MemoryInterface } from '@pyx-memory/client';
import { getSupportedExtensions, IngestionPipeline } from '@pyx-memory/core';
import type { MemoryIngestRequest, MemorySearchParams } from '@autonomy/shared';
import { MemoryType } from '@autonomy/shared';
import { BadRequestError, NotFoundError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';
import { validateMemoryType, validatePositiveInt, validateRAGStrategy } from '../validation.ts';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export function createMemoryRoutes(memory: MemoryInterface) {
  return {
    search: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const query = url.searchParams.get('query');
      if (!query) throw new BadRequestError('query parameter is required');

      const hydeParam = url.searchParams.get('enableHyDE');
      const rerankParam = url.searchParams.get('enableRerank');
      const params: MemorySearchParams = {
        query,
        limit: validatePositiveInt(url.searchParams.get('limit'), 'limit', 10),
        type: validateMemoryType(url.searchParams.get('type')),
        agentId: url.searchParams.get('agentId') ?? undefined,
        strategy: validateRAGStrategy(url.searchParams.get('strategy')),
        enableHyDE: hydeParam != null ? hydeParam === 'true' : undefined,
        enableRerank: rerankParam != null ? rerankParam === 'true' : undefined,
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

    stats: async (): Promise<Response> => {
      const stats = await memory.stats();
      return jsonResponse(stats);
    },

    entries: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const page = Math.min(100, validatePositiveInt(url.searchParams.get('page'), 'page', 1));
      const limit = Math.min(100, validatePositiveInt(url.searchParams.get('limit'), 'limit', 20));
      const query = url.searchParams.get('query') ?? undefined;

      // MemorySearchParams doesn't support offset — fetch enough results to
      // cover the requested page and slice. Capped at 1000 to bound the
      // vector search cost. A dedicated list() method on MemoryInterface
      // would be better for large-scale pagination.
      const fetchLimit = Math.min(1000, page * limit);
      const startIdx = (page - 1) * limit;

      const searchQuery = query ?? '*';
      const results = await memory.search({ query: searchQuery, limit: fetchLimit });
      const paged = results.entries.slice(startIdx, startIdx + limit);

      return jsonResponse({
        entries: paged,
        page,
        limit,
        totalCount: results.totalCount,
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

      // Validate file extension server-side
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const supported = getSupportedExtensions();
      if (!supported.includes(ext)) {
        throw new BadRequestError(
          `Unsupported file type "${ext}". Supported: ${supported.join(', ')}`,
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await IngestionPipeline.ingest(buffer, file.name, memory);

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
