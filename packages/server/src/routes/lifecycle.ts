import type { ExtendedMemoryInterface, MemoryInterface } from '@pyx-memory/client';
import { Memory } from '@pyx-memory/core';
import { BadRequestError, NotImplementedError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';
import { validateMemoryType, validatePositiveInt } from '../validation.ts';

/** Type guard: does the memory instance support lifecycle ops? */
export function isExtended(m: MemoryInterface): m is ExtendedMemoryInterface {
  return 'consolidate' in m;
}

/** Type guard: does the memory instance provide direct SQLite store access? */
function hasDirectAccess(m: MemoryInterface): m is Memory {
  return m instanceof Memory;
}

export function createLifecycleRoutes(memory: MemoryInterface, enableAdvanced = true) {
  if (!isExtended(memory)) {
    const unavailable = () => {
      throw new NotImplementedError('Lifecycle operations not available in remote mode');
    };
    return {
      consolidate: unavailable,
      forget: unavailable,
      summarizeSession: unavailable,
      decay: unavailable,
      reindex: unavailable,
      deleteBySource: unavailable,
      consolidationLog: unavailable,
      queryAsOf: unavailable,
    };
  }

  const ext = memory;

  const advancedDisabled = () =>
    new Response('Advanced memory routes are disabled', { status: 403 });

  return {
    consolidate: async (): Promise<Response> => {
      const result = await ext.consolidate();
      return jsonResponse(result);
    },

    forget: async (req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Memory entry id is required');
      const body = await parseJsonBody<{ reason?: string }>(req);
      const result = await ext.forget(id, body.reason);
      return jsonResponse({ forgotten: result });
    },

    summarizeSession: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { sessionId } = params;
      if (!sessionId) throw new BadRequestError('sessionId is required');
      const entry = await ext.summarizeSession(sessionId);
      return jsonResponse(entry);
    },

    decay: async (): Promise<Response> => {
      const archived = await ext.runDecay();
      return jsonResponse({ archivedCount: archived });
    },

    reindex: async (): Promise<Response> => {
      if (!enableAdvanced) return advancedDisabled();
      await ext.reindex();
      return jsonResponse({ reindexed: true });
    },

    deleteBySource: async (_req: Request, params: RouteParams): Promise<Response> => {
      if (!enableAdvanced) return advancedDisabled();
      const { source } = params;
      if (!source) throw new BadRequestError('source is required');
      const count = await ext.deleteBySource(decodeURIComponent(source));
      return jsonResponse({ deletedCount: count });
    },

    consolidationLog: async (req: Request): Promise<Response> => {
      if (!enableAdvanced) return advancedDisabled();
      if (!hasDirectAccess(memory)) {
        throw new NotImplementedError('Consolidation log requires direct memory access');
      }
      const store = memory.getSqliteStore();
      if (!store) {
        throw new NotImplementedError('SQLite store not available');
      }
      const url = new URL(req.url);
      const limit = validatePositiveInt(url.searchParams.get('limit'), 'limit', 10);
      const log = store.getConsolidationLog(limit);
      return jsonResponse({ log });
    },

    queryAsOf: async (req: Request): Promise<Response> => {
      if (!enableAdvanced) return advancedDisabled();
      if (!hasDirectAccess(memory)) {
        throw new NotImplementedError('Bi-temporal queries require direct memory access');
      }
      const store = memory.getSqliteStore();
      if (!store) {
        throw new NotImplementedError('SQLite store not available');
      }
      const url = new URL(req.url);
      const asOf = url.searchParams.get('asOf');
      if (!asOf) throw new BadRequestError('asOf date parameter is required');
      if (Number.isNaN(Date.parse(asOf))) {
        throw new BadRequestError('asOf must be a valid ISO 8601 date');
      }
      const type = validateMemoryType(url.searchParams.get('type'));
      const agentId = url.searchParams.get('agentId') ?? undefined;
      const limit = validatePositiveInt(url.searchParams.get('limit'), 'limit', 50);

      const entries = store.queryAsOf(asOf, { type, agentId, limit });
      return jsonResponse({ entries, totalCount: entries.length });
    },
  };
}
