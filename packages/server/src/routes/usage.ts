import type { AuthMiddleware, UsageStore } from '@autonomy/control-plane';
import { getAuthContext } from '@autonomy/control-plane';
import { ApiKeyScope, type QuotaConfig } from '@autonomy/shared';
import { BadRequestError, ServerError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';

export function createUsageRoutes(store: UsageStore, authMiddleware: AuthMiddleware) {
  function requireScope(req: Request, scope: ApiKeyScope): void {
    const ctx = getAuthContext(req);
    if (!authMiddleware.hasScope(ctx, scope)) {
      throw new ServerError('Insufficient permissions', 403);
    }
  }

  return {
    summary: async (req: Request): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const url = new URL(req.url);
      const rawPeriod = url.searchParams.get('period') ?? 'day';
      if (rawPeriod !== 'day' && rawPeriod !== 'month') {
        throw new BadRequestError('period must be "day" or "month"');
      }
      const period = rawPeriod;

      const summaries = store.getSummaries(period);
      return jsonResponse(summaries);
    },

    getQuota: async (req: Request, params: RouteParams): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const { keyId } = params;
      if (!keyId) throw new BadRequestError('keyId is required');

      const quota = store.getQuota(keyId);
      return jsonResponse(quota);
    },

    setQuota: async (req: Request, params: RouteParams): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const { keyId } = params;
      if (!keyId) throw new BadRequestError('keyId is required');

      const body = await parseJsonBody<Omit<QuotaConfig, 'apiKeyId'>>(req);

      store.setQuota({
        apiKeyId: keyId,
        maxRequestsPerDay: body.maxRequestsPerDay ?? 0,
        maxRequestsPerMonth: body.maxRequestsPerMonth ?? 0,
        maxAgents: body.maxAgents ?? 0,
      });

      const quota = store.getQuota(keyId);
      return jsonResponse(quota);
    },
  };
}
