import type { ExtendedMemoryInterface, MemoryInterface } from '@pyx-memory/client';
import { BadRequestError, ForbiddenError, NotImplementedError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';

/** Type guard: does the memory instance support lifecycle ops? */
export function isExtended(m: MemoryInterface): m is ExtendedMemoryInterface {
  return 'consolidate' in m;
}

export function createLifecycleRoutes(memory: MemoryInterface, enableAdvanced = true) {
  if (!isExtended(memory)) {
    const unavailable = () => {
      throw new NotImplementedError(
        'Lifecycle operations not available — memory service not connected',
      );
    };
    return {
      consolidate: unavailable,
      forget: unavailable,
      summarizeSession: unavailable,
      decay: unavailable,
      reindex: unavailable,
      deleteBySource: unavailable,
    };
  }

  const ext = memory;

  const advancedDisabled = () => {
    throw new ForbiddenError('Advanced memory routes are disabled');
  };

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
  };
}
