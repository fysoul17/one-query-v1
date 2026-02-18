import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { RateLimiter } from '../src/rate-limiter.ts';

function makeRequest(ip: string, path = '/api/agents'): Request {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-forwarded-for': ip },
  });
}

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.reset();
  });

  describe('constructor', () => {
    test('accepts configuration options', () => {
      limiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });
      expect(limiter).toBeDefined();
    });

    test('uses sensible defaults when no config provided', () => {
      limiter = new RateLimiter();
      expect(limiter).toBeDefined();
    });
  });

  describe('check()', () => {
    beforeEach(() => {
      limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000, trustProxy: true });
    });

    test('allows requests within limit', () => {
      const result = limiter.check(makeRequest('192.168.1.1'));
      expect(result.allowed).toBe(true);
    });

    test('allows exactly maxRequests before blocking', () => {
      const req = makeRequest('10.0.0.1');
      expect(limiter.check(req).allowed).toBe(true);
      expect(limiter.check(req).allowed).toBe(true);
      expect(limiter.check(req).allowed).toBe(true);
      // 4th request should be blocked
      expect(limiter.check(req).allowed).toBe(false);
    });

    test('returns remaining count that decreases', () => {
      const req = makeRequest('10.0.0.1');
      const r1 = limiter.check(req);
      expect(r1.remaining).toBe(2);

      const r2 = limiter.check(req);
      expect(r2.remaining).toBe(1);

      const r3 = limiter.check(req);
      expect(r3.remaining).toBe(0);
    });

    test('returns limit in result', () => {
      const result = limiter.check(makeRequest('10.0.0.1'));
      expect(result.limit).toBe(3);
    });

    test('returns resetTime as epoch seconds', () => {
      const before = Math.ceil(Date.now() / 1000);
      const result = limiter.check(makeRequest('10.0.0.1'));
      const after = Math.ceil((Date.now() + 60_000) / 1000);
      expect(result.resetTime).toBeGreaterThanOrEqual(before);
      expect(result.resetTime).toBeLessThanOrEqual(after);
    });

    test('returns retryAfter when limit exceeded', () => {
      const req = makeRequest('10.0.0.1');
      limiter.check(req);
      limiter.check(req);
      limiter.check(req);

      const result = limiter.check(req);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    });

    test('does not return retryAfter when within limit', () => {
      const result = limiter.check(makeRequest('10.0.0.1'));
      expect(result.retryAfter).toBeUndefined();
    });
  });

  describe('IP isolation', () => {
    beforeEach(() => {
      limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000, trustProxy: true });
    });

    test('different IPs have independent counters', () => {
      const reqA = makeRequest('10.0.0.1');
      const reqB = makeRequest('10.0.0.2');

      // Exhaust IP A
      limiter.check(reqA);
      limiter.check(reqA);
      expect(limiter.check(reqA).allowed).toBe(false);

      // IP B should still have its full quota
      expect(limiter.check(reqB).allowed).toBe(true);
      expect(limiter.check(reqB).allowed).toBe(true);
    });

    test('exhausting one IP does not affect others', () => {
      // Exhaust 10.0.0.1
      limiter.check(makeRequest('10.0.0.1'));
      limiter.check(makeRequest('10.0.0.1'));

      // 10.0.0.2 is independent
      const result = limiter.check(makeRequest('10.0.0.2'));
      expect(result.remaining).toBe(1);
    });
  });

  describe('window expiration', () => {
    test('allows new requests after window expires', async () => {
      limiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });

      const req = makeRequest('10.0.0.1');
      expect(limiter.check(req).allowed).toBe(true);
      expect(limiter.check(req).allowed).toBe(false);

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 80));

      // Should be allowed again
      expect(limiter.check(req).allowed).toBe(true);
    });

    test('resets counter after window expires', async () => {
      limiter = new RateLimiter({ maxRequests: 2, windowMs: 50 });

      const req = makeRequest('10.0.0.1');
      limiter.check(req);
      limiter.check(req);
      expect(limiter.check(req).allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 80));

      const result = limiter.check(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // fresh window
    });
  });

  describe('IP extraction', () => {
    beforeEach(() => {
      limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000, trustProxy: true });
    });

    test('extracts IP from X-Forwarded-For header when trust proxy enabled', () => {
      const req = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18' },
      });
      const result = limiter.check(req);
      expect(result.allowed).toBe(true);

      // Should use the leftmost (client) IP
      const req2 = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      // This should share the counter with the first request
      const result2 = limiter.check(req2);
      expect(result2.remaining).toBe(3);
    });

    test('uses leftmost IP from X-Forwarded-For chain', () => {
      const req = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' },
      });
      limiter.check(req);

      // Same client IP, different proxy chain
      const req2 = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '1.2.3.4, 99.99.99.99' },
      });
      const result = limiter.check(req2);
      // Should be on the same counter as req (client IP 1.2.3.4)
      expect(result.remaining).toBe(3);
    });

    test('falls back to unknown when no IP available and trust proxy enabled', () => {
      const req = new Request('http://localhost/api/test');
      const result = limiter.check(req);
      expect(result.allowed).toBe(true);
    });

    test('ignores X-Forwarded-For when trust proxy is disabled', () => {
      const noTrustLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 60_000,
        trustProxy: false,
      });

      const req1 = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });
      const req2 = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '5.6.7.8' },
      });

      noTrustLimiter.check(req1);
      noTrustLimiter.check(req2);

      // Both should be on the same counter (direct IP / unknown fallback)
      const result = noTrustLimiter.check(req1);
      expect(result.allowed).toBe(false);

      noTrustLimiter.reset();
    });
  });

  describe('rate limit response', () => {
    beforeEach(() => {
      limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    });

    test('toResponse() returns 429 with correct body when blocked', () => {
      const req = makeRequest('10.0.0.1');
      limiter.check(req);
      const result = limiter.check(req);

      expect(result.allowed).toBe(false);
      const response = limiter.toResponse(result);
      expect(response.status).toBe(429);
    });

    test('toResponse() includes Retry-After header', async () => {
      const req = makeRequest('10.0.0.1');
      limiter.check(req);
      const result = limiter.check(req);

      const response = limiter.toResponse(result);
      const retryAfter = response.headers.get('Retry-After');
      expect(retryAfter).not.toBeNull();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });

    test('toResponse() includes X-RateLimit-Limit header', async () => {
      const req = makeRequest('10.0.0.1');
      limiter.check(req);
      const result = limiter.check(req);

      const response = limiter.toResponse(result);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('1');
    });

    test('toResponse() includes X-RateLimit-Remaining header', async () => {
      const req = makeRequest('10.0.0.1');
      const result = limiter.check(req);

      const response = limiter.toResponse(result);
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    test('toResponse() includes X-RateLimit-Reset header', async () => {
      const req = makeRequest('10.0.0.1');
      const result = limiter.check(req);

      const response = limiter.toResponse(result);
      const reset = response.headers.get('X-RateLimit-Reset');
      expect(reset).not.toBeNull();
      expect(Number(reset)).toBeGreaterThan(0);
    });

    test('toResponse() body contains error message', async () => {
      const req = makeRequest('10.0.0.1');
      limiter.check(req);
      const result = limiter.check(req);

      const response = limiter.toResponse(result);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Rate limit exceeded');
    });
  });

  describe('addHeaders()', () => {
    test('adds rate limit headers to a normal response', () => {
      limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
      const req = makeRequest('10.0.0.1');
      const result = limiter.check(req);

      const response = new Response('ok');
      const withHeaders = limiter.addHeaders(response, result);

      expect(withHeaders.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(withHeaders.headers.get('X-RateLimit-Remaining')).toBe('9');
      expect(withHeaders.headers.get('X-RateLimit-Reset')).not.toBeNull();
    });
  });

  describe('health endpoint exemption', () => {
    beforeEach(() => {
      limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    });

    test('/health requests are not rate limited', () => {
      const healthReq = makeRequest('10.0.0.1', '/health');

      // First request
      expect(limiter.check(healthReq).allowed).toBe(true);
      // Second request should still pass (exempt)
      expect(limiter.check(healthReq).allowed).toBe(true);
      // Third request should still pass
      expect(limiter.check(healthReq).allowed).toBe(true);
    });

    test('/health exempt flag is set in result', () => {
      const healthReq = makeRequest('10.0.0.1', '/health');
      const result = limiter.check(healthReq);
      expect(result.exempt).toBe(true);
    });

    test('non-health endpoints are still rate limited', () => {
      const req = makeRequest('10.0.0.1', '/api/agents');
      limiter.check(req);
      expect(limiter.check(req).allowed).toBe(false);
    });

    test('health requests do not consume rate limit quota', () => {
      // Hit health endpoint many times
      const healthReq = makeRequest('10.0.0.1', '/health');
      limiter.check(healthReq);
      limiter.check(healthReq);
      limiter.check(healthReq);

      // API request should still have full quota
      const apiReq = makeRequest('10.0.0.1', '/api/agents');
      const result = limiter.check(apiReq);
      expect(result.allowed).toBe(true);
    });
  });

  describe('configurable limits', () => {
    test('respects custom maxRequests', () => {
      limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
      const req = makeRequest('10.0.0.1');

      for (let i = 0; i < 5; i++) {
        expect(limiter.check(req).allowed).toBe(true);
      }
      expect(limiter.check(req).allowed).toBe(false);
    });

    test('respects custom windowMs', async () => {
      limiter = new RateLimiter({ maxRequests: 1, windowMs: 30 });
      const req = makeRequest('10.0.0.1');

      limiter.check(req);
      expect(limiter.check(req).allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 50));
      expect(limiter.check(req).allowed).toBe(true);
    });
  });

  describe('max entries eviction', () => {
    test('evicts oldest entries when maxEntries exceeded', () => {
      limiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60_000,
        maxEntries: 3,
        trustProxy: true,
      });

      // Fill up with 3 unique IPs
      limiter.check(makeRequest('10.0.0.1'));
      limiter.check(makeRequest('10.0.0.2'));
      limiter.check(makeRequest('10.0.0.3'));

      // Adding a 4th IP should trigger eviction of the oldest
      limiter.check(makeRequest('10.0.0.4'));

      // The oldest (10.0.0.1) should have been evicted,
      // so a new request from that IP gets a fresh counter
      const result = limiter.check(makeRequest('10.0.0.1'));
      expect(result.remaining).toBe(99); // fresh entry: 100 - 1 = 99
    });
  });

  describe('memory exhaustion protection', () => {
    test('map size stays at maxEntries cap under high cardinality', () => {
      const maxEntries = 100;
      limiter = new RateLimiter({
        maxRequests: 10,
        windowMs: 60_000,
        maxEntries,
        trustProxy: true,
      });

      // Create far more unique IPs than maxEntries allows
      for (let i = 0; i < 500; i++) {
        const ip = `10.${Math.floor(i / 256)}.${i % 256}.1`;
        limiter.check(makeRequest(ip));
      }

      // Internal map should never exceed maxEntries
      expect(limiter.size).toBeLessThanOrEqual(maxEntries);
    });

    test('eviction under load does not corrupt existing entries', () => {
      limiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 60_000,
        maxEntries: 5,
        trustProxy: true,
      });

      // Fill the limiter to capacity
      for (let i = 1; i <= 5; i++) {
        limiter.check(makeRequest(`10.0.0.${i}`));
      }

      // Use one IP twice to approach its limit
      limiter.check(makeRequest('10.0.0.5'));

      // Trigger evictions by adding new IPs
      for (let i = 6; i <= 10; i++) {
        limiter.check(makeRequest(`10.0.0.${i}`));
      }

      // Most recent IP (10.0.0.10) should work correctly
      const result = limiter.check(makeRequest('10.0.0.10'));
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 2 max - 2 used = 0
    });
  });

  describe('security: header spoofing', () => {
    test('spoofed X-Forwarded-For is ignored when trust proxy is false', () => {
      limiter = new RateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
        trustProxy: false,
      });

      // Attacker sends requests with different spoofed IPs
      const req1 = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '1.1.1.1' },
      });
      const req2 = new Request('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '2.2.2.2' },
      });

      limiter.check(req1);
      // Despite different X-Forwarded-For, should be blocked (same real IP)
      const result = limiter.check(req2);
      expect(result.allowed).toBe(false);
    });

    test('rate limit headers are present on allowed responses via addHeaders', () => {
      limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
      const result = limiter.check(makeRequest('10.0.0.1'));
      const response = limiter.addHeaders(new Response('ok'), result);

      // All three headers must always be present
      expect(response.headers.has('X-RateLimit-Limit')).toBe(true);
      expect(response.headers.has('X-RateLimit-Remaining')).toBe(true);
      expect(response.headers.has('X-RateLimit-Reset')).toBe(true);
    });

    test('rate limit headers are present on blocked responses via toResponse', () => {
      limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const req = makeRequest('10.0.0.1');
      limiter.check(req);
      const result = limiter.check(req);
      const response = limiter.toResponse(result);

      expect(response.headers.has('X-RateLimit-Limit')).toBe(true);
      expect(response.headers.has('X-RateLimit-Remaining')).toBe(true);
      expect(response.headers.has('X-RateLimit-Reset')).toBe(true);
      expect(response.headers.has('Retry-After')).toBe(true);
    });
  });

  describe('reset()', () => {
    test('clears all rate limit state', () => {
      limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
      const req = makeRequest('10.0.0.1');

      limiter.check(req);
      expect(limiter.check(req).allowed).toBe(false);

      limiter.reset();

      // After reset, should have full quota
      expect(limiter.check(req).allowed).toBe(true);
    });
  });
});
