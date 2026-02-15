import { describe, expect, test } from 'bun:test';
import { MockConductor } from '../helpers/mock-conductor.ts';
import { createHealthRoute } from '../../src/routes/health.ts';

// Use a duck-typed mock for Memory
function createMockMemory(shouldThrow = false) {
  return {
    async stats() {
      if (shouldThrow) throw new Error('memory error');
      return { totalEntries: 10, storageUsedBytes: 1024, vectorCount: 5, recentAccessCount: 3 };
    },
  };
}

describe('GET /health', () => {
  test('returns ok status with agent count and uptime', async () => {
    const conductor = new MockConductor();
    await conductor.initialize();
    const memory = createMockMemory();
    const startTime = Date.now() - 5000;

    const handler = createHealthRoute(conductor as any, memory as any, startTime);
    const res = await handler();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.agentCount).toBe(0);
    expect(body.data.uptime).toBeGreaterThanOrEqual(4);
    expect(body.data.memoryStatus).toBe('ok');
    expect(body.data.version).toBe('0.0.0');
  });

  test('returns degraded when memory throws', async () => {
    const conductor = new MockConductor();
    await conductor.initialize();
    const memory = createMockMemory(true);
    const startTime = Date.now();

    const handler = createHealthRoute(conductor as any, memory as any, startTime);
    const res = await handler();
    const body = await res.json();

    expect(body.data.status).toBe('degraded');
    expect(body.data.memoryStatus).toBe('error');
  });
});
