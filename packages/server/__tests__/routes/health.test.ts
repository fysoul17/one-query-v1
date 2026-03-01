import { describe, expect, test } from 'bun:test';
import type { BackendRegistry } from '@autonomy/agent-manager';
import type { Conductor } from '@autonomy/conductor';
import type { AIBackend, BackendStatus } from '@autonomy/shared';
import type { MemoryInterface } from '@pyx-memory/client';
import { createHealthRoute } from '../../src/routes/health.ts';
import { MockConductor } from '../helpers/mock-conductor.ts';

// Use a duck-typed mock for Memory
function createMockMemory(shouldThrow = false) {
  return {
    async stats() {
      if (shouldThrow) throw new Error('memory error');
      return { totalEntries: 10, storageUsedBytes: 1024, vectorCount: 5, recentAccessCount: 3 };
    },
  };
}

function createMockRegistry(
  defaultName: AIBackend = 'claude',
  statuses: BackendStatus[] = [],
): BackendRegistry {
  return {
    get: () => {
      throw new Error('not used');
    },
    getDefault: () => {
      throw new Error('not used');
    },
    getDefaultName: () => defaultName,
    has: () => false,
    list: () => statuses.map((s) => s.name),
    getStatusAll: async () => statuses,
  } as unknown as BackendRegistry;
}

describe('GET /health', () => {
  test('returns ok status with agent count and uptime', async () => {
    const conductor = new MockConductor();
    await conductor.initialize();
    const memory = createMockMemory();
    const startTime = Date.now() - 5000;

    const handler = createHealthRoute(
      conductor as unknown as Conductor,
      memory as unknown as MemoryInterface,
      startTime,
    );
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

    const handler = createHealthRoute(
      conductor as unknown as Conductor,
      memory as unknown as MemoryInterface,
      startTime,
    );
    const res = await handler();
    const body = await res.json();

    expect(body.data.status).toBe('degraded');
    expect(body.data.memoryStatus).toBe('error');
  });

  test('includes backendStatus when registry provided', async () => {
    const conductor = new MockConductor();
    await conductor.initialize();
    const memory = createMockMemory();
    const startTime = Date.now();

    const registry = createMockRegistry('claude', [
      {
        name: 'claude',
        available: true,
        configured: true,
        authenticated: true,
        authMode: 'api_key',
        capabilities: {
          customTools: true,
          streaming: true,
          sessionPersistence: true,
          fileAccess: true,
        },
      } as BackendStatus,
      {
        name: 'ollama',
        available: true,
        configured: false,
        authenticated: false,
        authMode: 'none',
        capabilities: {
          customTools: false,
          streaming: false,
          sessionPersistence: false,
          fileAccess: false,
        },
      } as BackendStatus,
    ]);

    const handler = createHealthRoute(
      conductor as unknown as Conductor,
      memory as unknown as MemoryInterface,
      startTime,
      registry,
    );
    const res = await handler();
    const body = await res.json();

    expect(body.data.status).toBe('ok');
    expect(body.data.backendStatus).toBeDefined();
    expect(body.data.backendStatus.default).toBe('claude');
    expect(body.data.backendStatus.backends).toHaveLength(2);
    expect(body.data.backendStatus.backends[0].name).toBe('claude');
    expect(body.data.backendStatus.backends[0].available).toBe(true);
    expect(body.data.backendStatus.backends[0].authenticated).toBe(true);
    expect(body.data.backendStatus.backends[1].name).toBe('ollama');
    expect(body.data.backendStatus.backends[1].authenticated).toBe(false);
  });

  test('status is degraded when default backend not authenticated', async () => {
    const conductor = new MockConductor();
    await conductor.initialize();
    const memory = createMockMemory();
    const startTime = Date.now();

    const registry = createMockRegistry('claude', [
      {
        name: 'claude',
        available: true,
        configured: false,
        authenticated: false,
        authMode: 'none',
        capabilities: {
          customTools: true,
          streaming: true,
          sessionPersistence: true,
          fileAccess: true,
        },
      } as BackendStatus,
    ]);

    const handler = createHealthRoute(
      conductor as unknown as Conductor,
      memory as unknown as MemoryInterface,
      startTime,
      registry,
    );
    const res = await handler();
    const body = await res.json();

    expect(body.data.status).toBe('degraded');
    expect(body.data.backendStatus).toBeDefined();
    expect(body.data.backendStatus.default).toBe('claude');
  });
});
