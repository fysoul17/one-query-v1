import { describe, expect, test } from 'bun:test';
import { EmbeddingProviderName } from '@autonomy/shared';
import { createHealthRoute } from '../../src/routes/health.ts';

function mockMemory(statsResult?: object, shouldThrow = false) {
  return {
    stats: async () => {
      if (shouldThrow) throw new Error('memory failure');
      return {
        totalEntries: 42,
        vectorCount: 40,
        storageUsedBytes: 8192,
        recentAccessCount: 10,
        ...(statsResult ?? {}),
      };
    },
  } as any;
}

describe('Health route', () => {
  test('returns ok status with stats', async () => {
    const handler = createHealthRoute(mockMemory(), EmbeddingProviderName.STUB, Date.now() - 5000);
    const res = await handler(new Request('http://localhost/health'), {});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.memoryStatus).toBe('ok');
    expect(body.data.embeddingProvider).toBe('stub');
    expect(body.data.stats.totalEntries).toBe(42);
    expect(body.data.stats.vectorCount).toBe(40);
    expect(body.data.stats.storageUsedBytes).toBe(8192);
    expect(body.data.uptime).toBeGreaterThanOrEqual(4);
  });

  test('returns degraded when memory throws', async () => {
    const handler = createHealthRoute(
      mockMemory(undefined, true),
      EmbeddingProviderName.STUB,
      Date.now(),
    );
    const res = await handler(new Request('http://localhost/health'), {});
    const body = await res.json();

    expect(body.data.status).toBe('degraded');
    expect(body.data.memoryStatus).toBe('error');
    expect(body.data.stats).toBeUndefined();
  });

  test('includes version field', async () => {
    const handler = createHealthRoute(mockMemory(), EmbeddingProviderName.STUB, Date.now());
    const res = await handler(new Request('http://localhost/health'), {});
    const body = await res.json();

    expect(body.data.version).toBeDefined();
  });
});
