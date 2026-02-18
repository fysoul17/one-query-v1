import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ApiKey } from '@autonomy/shared';
import { ApiKeyScope } from '@autonomy/shared';
import type { AuthContext } from '../src/auth-middleware.ts';
import { QuotaManager } from '../src/quota-manager.ts';
import { UsageStore } from '../src/usage-store.ts';

function makeAuthContext(apiKeyId: string): AuthContext {
  return {
    authenticated: true,
    apiKey: {
      id: apiKeyId,
      name: 'Test',
      keyPrefix: 'ak_test',
      scopes: [ApiKeyScope.READ],
      rateLimit: 0,
      createdAt: new Date().toISOString(),
      enabled: true,
    } as ApiKey,
    scopes: [ApiKeyScope.READ],
  };
}

describe('QuotaManager', () => {
  let db: Database;
  let usageStore: UsageStore;
  let quotaManager: QuotaManager;

  beforeEach(() => {
    db = new Database(':memory:');
    usageStore = new UsageStore(db);
    quotaManager = new QuotaManager(usageStore);
  });

  afterEach(() => {
    db.close();
  });

  test('allows anonymous requests', () => {
    const ctx: AuthContext = { authenticated: false, apiKey: null, scopes: [] };
    expect(quotaManager.check(ctx)).toBeNull();
  });

  test('allows requests when no quota set', () => {
    const ctx = makeAuthContext('key-1');
    expect(quotaManager.check(ctx)).toBeNull();
  });

  test('allows requests within daily limit', () => {
    usageStore.setQuota({
      apiKeyId: 'key-1',
      maxRequestsPerDay: 10,
      maxRequestsPerMonth: 0,
      maxAgents: 0,
    });

    usageStore.record({
      apiKeyId: 'key-1',
      endpoint: '/api/agents',
      method: 'GET',
      statusCode: 200,
      timestamp: new Date().toISOString(),
      durationMs: 10,
    });

    const ctx = makeAuthContext('key-1');
    expect(quotaManager.check(ctx)).toBeNull();
  });

  test('returns 429 when daily limit exceeded', () => {
    usageStore.setQuota({
      apiKeyId: 'key-1',
      maxRequestsPerDay: 2,
      maxRequestsPerMonth: 0,
      maxAgents: 0,
    });

    // Record 2 requests (at limit)
    for (let i = 0; i < 2; i++) {
      usageStore.record({
        apiKeyId: 'key-1',
        endpoint: '/api/agents',
        method: 'GET',
        statusCode: 200,
        timestamp: new Date().toISOString(),
        durationMs: 10,
      });
    }

    const ctx = makeAuthContext('key-1');
    const result = quotaManager.check(ctx);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(429);
  });

  test('returns 429 when monthly limit exceeded', () => {
    usageStore.setQuota({
      apiKeyId: 'key-1',
      maxRequestsPerDay: 0,
      maxRequestsPerMonth: 1,
      maxAgents: 0,
    });

    usageStore.record({
      apiKeyId: 'key-1',
      endpoint: '/api/agents',
      method: 'GET',
      statusCode: 200,
      timestamp: new Date().toISOString(),
      durationMs: 10,
    });

    const ctx = makeAuthContext('key-1');
    const result = quotaManager.check(ctx);
    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(429);
  });
});
