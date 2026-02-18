import type { AuthContext } from './auth-middleware.ts';
import type { UsageStore } from './usage-store.ts';

export class QuotaManager {
  private store: UsageStore;

  constructor(store: UsageStore) {
    this.store = store;
  }

  /**
   * Check if the request is within quota limits.
   * Returns null if allowed, or a 429 Response if quota exceeded.
   */
  check(authCtx: AuthContext): Response | null {
    // Anonymous requests and non-authenticated requests bypass quota
    if (!authCtx.authenticated || !authCtx.apiKey) {
      return null;
    }

    const quota = this.store.getQuota(authCtx.apiKey.id);
    if (!quota) {
      // No quota configured — allow
      return null;
    }

    const now = new Date();

    // Check daily limit
    if (quota.maxRequestsPerDay > 0) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const dailyCount = this.store.getRequestCount(authCtx.apiKey.id, dayStart);
      if (dailyCount >= quota.maxRequestsPerDay) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Daily request quota exceeded',
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Retry-After': '3600',
            },
          },
        );
      }
    }

    // Check monthly limit
    if (quota.maxRequestsPerMonth > 0) {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthlyCount = this.store.getRequestCount(authCtx.apiKey.id, monthStart);
      if (monthlyCount >= quota.maxRequestsPerMonth) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Monthly request quota exceeded',
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Retry-After': '86400',
            },
          },
        );
      }
    }

    return null;
  }
}
