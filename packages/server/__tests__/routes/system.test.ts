import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentPool } from '@autonomy/agent-manager';
import type { CronManager } from '@autonomy/cron-manager';
import type { MemoryInterface } from '@autonomy/shared';
import type { AgentStore } from '../../src/agent-store.ts';
import { DisabledMemory } from '../../src/disabled-memory.ts';
import { createSystemRoutes } from '../../src/routes/system.ts';
import type { SessionStore } from '../../src/session-store.ts';
import { MockMemory } from '../helpers/mock-memory.ts';
import { MockPool } from '../helpers/mock-pool.ts';

function createMockAgentStore() {
  return {
    deleteAllCalls: 0,
    deleteAll() {
      this.deleteAllCalls++;
    },
    upsertSeed() {
      return true;
    },
  };
}

function createMockSessionStore() {
  return {
    deleteAllCalls: 0,
    deleteAll() {
      this.deleteAllCalls++;
    },
  };
}

function createMockCronManager() {
  return {
    removeAllCalls: 0,
    async removeAll() {
      this.removeAllCalls++;
    },
    list() {
      return [];
    },
    async create() {
      return { id: 'cron-1', name: 'seed', schedule: '0 * * * *' };
    },
  };
}

function makeResetRequest(body: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/system/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('System routes', () => {
  let pool: MockPool;
  let agentStore: ReturnType<typeof createMockAgentStore>;
  let sessionStore: ReturnType<typeof createMockSessionStore>;
  let cronManager: ReturnType<typeof createMockCronManager>;
  let memory: MockMemory;
  let routes: ReturnType<typeof createSystemRoutes>;

  beforeEach(() => {
    pool = new MockPool();
    agentStore = createMockAgentStore();
    sessionStore = createMockSessionStore();
    cronManager = createMockCronManager();
    memory = new MockMemory();
    // Add restore() for re-seeding step
    (pool as unknown as Record<string, unknown>).restore = async () => {};
    routes = createSystemRoutes({
      pool: pool as unknown as AgentPool,
      agentStore: agentStore as unknown as AgentStore,
      sessionStore: sessionStore as unknown as SessionStore,
      cronManager: cronManager as unknown as CronManager,
      memory: memory as unknown as MemoryInterface,
    });
  });

  describe('POST /api/system/reset', () => {
    test('resets all subsystems and returns success', async () => {
      const res = await routes.reset(makeResetRequest());
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.reset).toBe(true);
      expect(body.data.memoryPurged).toBe(false);
      expect(body.data.seedFailed).toBe(false);
      expect(typeof body.data.agentsRestored).toBe('number');
    });

    test('calls shutdown on agent pool', async () => {
      await routes.reset(makeResetRequest());
      // MockPool.shutdown() stops all agents and clears the map
      expect(pool.list().length).toBe(0);
    });

    test('calls deleteAll on agent store and session store', async () => {
      await routes.reset(makeResetRequest());
      expect(agentStore.deleteAllCalls).toBe(1);
      expect(sessionStore.deleteAllCalls).toBe(1);
    });

    test('calls removeAll on cron manager', async () => {
      await routes.reset(makeResetRequest());
      expect(cronManager.removeAllCalls).toBe(1);
    });

    test('does not purge memory when purgeMemory is false', async () => {
      await routes.reset(makeResetRequest({ purgeMemory: false }));
      const body = await (await routes.reset(makeResetRequest())).json();
      expect(body.data.memoryPurged).toBe(false);
      expect(body.data.memoryEntriesDeleted).toBe(0);
    });

    test('does not purge memory when memory is DisabledMemory', async () => {
      const disabled = new DisabledMemory();
      await disabled.initialize();
      const disabledRoutes = createSystemRoutes({
        pool: pool as unknown as AgentPool,
        agentStore: agentStore as unknown as AgentStore,
        sessionStore: sessionStore as unknown as SessionStore,
        cronManager: cronManager as unknown as CronManager,
        memory: disabled,
      });

      const res = await disabledRoutes.reset(makeResetRequest({ purgeMemory: true }));
      const body = await res.json();
      expect(body.data.memoryPurged).toBe(false);
    });

    test('purges memory when purgeMemory is true and memory is connected', async () => {
      // Set up memory with entries to delete
      let listCallCount = 0;
      const memoryWithEntries = {
        ...memory,
        async list() {
          listCallCount++;
          if (listCallCount === 1) {
            return {
              entries: [
                { id: 'e1', content: 'test', type: 'long-term', metadata: {}, createdAt: '' },
                { id: 'e2', content: 'test', type: 'long-term', metadata: {}, createdAt: '' },
              ],
              totalCount: 2,
              page: 1,
              limit: 100,
            };
          }
          return { entries: [], totalCount: 0, page: 1, limit: 100 };
        },
        deleteCalls: [] as string[],
        async delete(id: string) {
          this.deleteCalls.push(id);
          return true;
        },
      };

      const purgeRoutes = createSystemRoutes({
        pool: pool as unknown as AgentPool,
        agentStore: agentStore as unknown as AgentStore,
        sessionStore: sessionStore as unknown as SessionStore,
        cronManager: cronManager as unknown as CronManager,
        memory: memoryWithEntries as unknown as MemoryInterface,
      });

      const res = await purgeRoutes.reset(makeResetRequest({ purgeMemory: true }));
      const body = await res.json();
      expect(body.data.memoryPurged).toBe(true);
      expect(body.data.memoryEntriesDeleted).toBe(2);
      expect(memoryWithEntries.deleteCalls).toEqual(['e1', 'e2']);
    });

    test('handles memory purge failure gracefully', async () => {
      const failingMemory = {
        ...memory,
        async list() {
          throw new Error('memory unavailable');
        },
      };

      const failRoutes = createSystemRoutes({
        pool: pool as unknown as AgentPool,
        agentStore: agentStore as unknown as AgentStore,
        sessionStore: sessionStore as unknown as SessionStore,
        cronManager: cronManager as unknown as CronManager,
        memory: failingMemory as unknown as MemoryInterface,
      });

      const res = await failRoutes.reset(makeResetRequest({ purgeMemory: true }));
      const body = await res.json();
      // Should complete without throwing, memory purge failed but rest succeeded
      expect(body.data.reset).toBe(true);
      expect(body.data.memoryPurged).toBe(false);
    });

    test('reports seedFailed when re-seeding throws', async () => {
      // After pool.shutdown(), pool.restore() will work on MockPool but
      // seeds import the real seeds module — mock via a pool that throws on restore
      const brokenPool = {
        ...pool,
        async shutdown() {},
        list() {
          return [];
        },
        async restore() {
          throw new Error('restore failed');
        },
      };

      const brokenRoutes = createSystemRoutes({
        pool: brokenPool as unknown as AgentPool,
        agentStore: agentStore as unknown as AgentStore,
        sessionStore: sessionStore as unknown as SessionStore,
        cronManager: cronManager as unknown as CronManager,
        memory: memory as unknown as MemoryInterface,
      });

      const res = await brokenRoutes.reset(makeResetRequest());
      const body = await res.json();
      expect(body.data.reset).toBe(true);
      expect(body.data.seedFailed).toBe(true);
    });
  });
});
