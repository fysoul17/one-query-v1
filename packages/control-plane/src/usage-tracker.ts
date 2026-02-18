import type { AuthContext } from './auth-middleware.ts';
import type { UsageStore } from './usage-store.ts';

export class UsageTracker {
  private store: UsageStore;

  constructor(store: UsageStore) {
    this.store = store;
  }

  /** Record usage after a request completes (fire-and-forget). */
  track(req: Request, res: Response, authCtx: AuthContext, durationMs: number): void {
    try {
      const url = new URL(req.url);
      this.store.record({
        apiKeyId: authCtx.apiKey?.id ?? null,
        endpoint: url.pathname,
        method: req.method,
        statusCode: res.status,
        timestamp: new Date().toISOString(),
        durationMs,
      });
    } catch {
      // Fire-and-forget — don't break the response
    }
  }
}
