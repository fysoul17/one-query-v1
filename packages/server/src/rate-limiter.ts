interface RateLimiterConfig {
  maxRequests?: number;
  windowMs?: number;
  maxEntries?: number;
  trustProxy?: boolean;
  excludedPaths?: string[];
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  exempt?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;
  private maxEntries: number;
  private trustProxy: boolean;
  private excludedPaths: Set<string>;
  private checksSinceEviction = 0;
  private evictionInterval = 100; // Run eviction every N checks

  constructor(config: RateLimiterConfig = {}) {
    this.maxRequests = config.maxRequests ?? 100;
    this.windowMs = config.windowMs ?? 60_000;
    this.maxEntries = config.maxEntries ?? 10_000;
    this.trustProxy = config.trustProxy ?? false;
    this.excludedPaths = new Set(config.excludedPaths ?? ['/health']);
  }

  get size(): number {
    return this.store.size;
  }

  check(
    req: Request,
    server?: { requestIP(req: Request): { address: string } | null },
  ): RateLimitResult {
    const url = new URL(req.url);

    if (this.excludedPaths.has(url.pathname)) {
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: this.maxRequests,
        resetTime: Math.ceil((Date.now() + this.windowMs) / 1000),
        exempt: true,
      };
    }

    const ip = this.extractIP(req, server);
    const now = Date.now();
    let entry = this.store.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.store.set(ip, entry);
    }

    entry.count++;

    // Evict when over capacity, or periodically sweep expired entries
    if (this.store.size > this.maxEntries) {
      this.evictIfNeeded();
      this.checksSinceEviction = 0;
    } else {
      this.checksSinceEviction++;
      if (this.checksSinceEviction >= this.evictionInterval) {
        this.checksSinceEviction = 0;
        this.sweepExpired();
      }
    }

    const allowed = entry.count <= this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - entry.count);
    const resetTime = Math.ceil(entry.resetAt / 1000);

    const result: RateLimitResult = {
      allowed,
      limit: this.maxRequests,
      remaining,
      resetTime,
    };

    if (!allowed) {
      result.retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    }

    return result;
  }

  toResponse(result: RateLimitResult): Response {
    const headers = this.buildHeaders(result);
    if (result.retryAfter !== undefined) {
      headers['Retry-After'] = String(result.retryAfter);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Rate limit exceeded. Please try again later.',
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
    );
  }

  addHeaders(response: Response, result: RateLimitResult): Response {
    const headers = this.buildHeaders(result);
    // Set headers in-place to avoid re-wrapping the Response body,
    // which breaks ReadableStream-based streaming responses in Bun.
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }

  reset(): void {
    this.store.clear();
  }

  private extractIP(
    req: Request,
    server?: { requestIP(req: Request): { address: string } | null },
  ): string {
    if (this.trustProxy) {
      const xff = req.headers.get('x-forwarded-for');
      if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
      }
    }

    if (server) {
      const addr = server.requestIP(req);
      if (addr?.address) return addr.address;
    }

    return 'unknown';
  }

  private buildHeaders(result: RateLimitResult): Record<string, string> {
    return {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(result.resetTime),
    };
  }

  /** Lightweight sweep: remove only expired entries. Called periodically when under cap. */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }

  /** Full eviction: sweep expired, then force-evict oldest if still over cap. */
  private evictIfNeeded(): void {
    this.sweepExpired();

    if (this.store.size <= this.maxEntries) return;

    // Evict oldest entries (Map preserves insertion order)
    const excess = this.store.size - this.maxEntries;
    let removed = 0;
    for (const key of this.store.keys()) {
      if (removed >= excess) break;
      this.store.delete(key);
      removed++;
    }
  }
}
