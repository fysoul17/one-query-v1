import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AgentPool } from '@autonomy/agent-manager';
import { type AgentDefinition, type AgentRuntimeInfo, AgentStatus } from '@autonomy/shared';
import type { MemoryInterface } from '@pyx-memory/client';
import { Conductor } from '../src/conductor.ts';
import { QueueFullError } from '../src/errors.ts';
import { ConductorEventType, type OnConductorEvent } from '../src/types.ts';
import { makeAgent, makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

/**
 * Creates a mock pool with configurable async delay on sendMessage.
 * The delay allows us to detect whether handleMessage calls run concurrently
 * or are properly serialized by a queue.
 */
function createDelayMockPool(delayMs = 50) {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();
  let callOrder: number[] = [];
  let callCount = 0;
  let concurrentCount = 0;
  let maxConcurrent = 0;

  const pool = {
    callOrder() {
      return callOrder;
    },
    maxConcurrent() {
      return maxConcurrent;
    },
    resetTracking() {
      callOrder = [];
      callCount = 0;
      concurrentCount = 0;
      maxConcurrent = 0;
    },
    create: mock(async (definition: AgentDefinition) => {
      const runtime: AgentRuntimeInfo = {
        id: definition.id,
        name: definition.name,
        role: definition.role,
        status: AgentStatus.IDLE,
        owner: definition.owner,
        persistent: definition.persistent,
        createdAt: definition.createdAt,
      };
      agents.set(definition.id, { definition, runtime });
      return {
        id: definition.id,
        definition,
        toRuntimeInfo: () => runtime,
      };
    }),
    get: mock((id: string) => {
      const entry = agents.get(id);
      if (!entry) return undefined;
      return { definition: entry.definition, toRuntimeInfo: () => entry.runtime };
    }),
    list: mock(() => [...agents.values()].map((a) => a.runtime)),
    remove: mock(async (id: string) => {
      agents.delete(id);
    }),
    sendMessage: mock(async (_id: string, _msg: string) => {
      const myOrder = ++callCount;
      concurrentCount++;
      if (concurrentCount > maxConcurrent) {
        maxConcurrent = concurrentCount;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      concurrentCount--;
      callOrder.push(myOrder);
      return `Response ${myOrder}`;
    }),
    shutdown: mock(async () => {
      agents.clear();
    }),
    _agents: agents,
  };

  return pool;
}

describe('Conductor — message queue', () => {
  let conductor: Conductor;
  let pool: ReturnType<typeof createDelayMockPool>;
  let memory: MockMemory;

  beforeEach(async () => {
    pool = createDelayMockPool(50);
    memory = new MockMemory();
    conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as MemoryInterface);
    await conductor.initialize();

    // Set up one agent so routing delegates to it
    const def = makeAgent({ id: 'worker', name: 'Worker', role: 'worker' });
    await pool.create(def);
    pool.resetTracking();
  });

  describe('concurrent handleMessage calls serialize', () => {
    test('two concurrent handleMessage calls execute sequentially, not in parallel', async () => {
      const msg1 = makeMessage({ content: 'First message', targetAgentId: 'worker' });
      const msg2 = makeMessage({ content: 'Second message', targetAgentId: 'worker' });

      // Fire both at the same time
      const [res1, res2] = await Promise.all([
        conductor.handleMessage(msg1),
        conductor.handleMessage(msg2),
      ]);

      // Both should succeed
      expect(res1.content).toBeTruthy();
      expect(res2.content).toBeTruthy();

      // With a queue, max concurrency on sendMessage should be 1 (serialized)
      // Without a queue, both handleMessage calls race and sendMessage gets called concurrently
      expect(pool.maxConcurrent()).toBe(1);
    });

    test('call order is preserved (FIFO)', async () => {
      const msg1 = makeMessage({ content: 'First', targetAgentId: 'worker' });
      const msg2 = makeMessage({ content: 'Second', targetAgentId: 'worker' });
      const msg3 = makeMessage({ content: 'Third', targetAgentId: 'worker' });

      await Promise.all([
        conductor.handleMessage(msg1),
        conductor.handleMessage(msg2),
        conductor.handleMessage(msg3),
      ]);

      // sendMessage call order should be [1, 2, 3] proving FIFO processing
      expect(pool.callOrder()).toEqual([1, 2, 3]);
    });
  });

  describe('queueDepth tracking', () => {
    test('queueDepth reflects pending messages', async () => {
      // Use a longer delay to observe queue depth during processing
      pool = createDelayMockPool(100);
      memory = new MockMemory();
      conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as MemoryInterface);
      await conductor.initialize();
      const def = makeAgent({ id: 'worker', name: 'Worker', role: 'worker' });
      await pool.create(def);

      const msg1 = makeMessage({ content: 'First', targetAgentId: 'worker' });
      const msg2 = makeMessage({ content: 'Second', targetAgentId: 'worker' });
      const msg3 = makeMessage({ content: 'Third', targetAgentId: 'worker' });

      // Fire all three concurrently
      const p1 = conductor.handleMessage(msg1);
      const p2 = conductor.handleMessage(msg2);
      const p3 = conductor.handleMessage(msg3);

      // After a small tick, one message is processing and two are queued
      await new Promise((r) => setTimeout(r, 10));

      // queueDepth should exist and show pending messages
      expect(conductor.queueDepth).toBeGreaterThanOrEqual(1);

      await Promise.all([p1, p2, p3]);

      // After all are processed, queue should be empty
      expect(conductor.queueDepth).toBe(0);
    });
  });

  describe('shutdown rejects pending queued messages', () => {
    test('pending messages are rejected when shutdown is called', async () => {
      pool = createDelayMockPool(200); // slow enough that messages queue up
      memory = new MockMemory();
      conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as MemoryInterface);
      await conductor.initialize();
      const def = makeAgent({ id: 'worker', name: 'Worker', role: 'worker' });
      await pool.create(def);

      const msg1 = makeMessage({ content: 'First', targetAgentId: 'worker' });
      const msg2 = makeMessage({ content: 'Second', targetAgentId: 'worker' });
      const msg3 = makeMessage({ content: 'Third', targetAgentId: 'worker' });

      // Fire three messages — first starts processing, others queue
      const p1 = conductor.handleMessage(msg1);
      const p2 = conductor.handleMessage(msg2);
      const p3 = conductor.handleMessage(msg3);

      // Give the first message a moment to start processing
      await new Promise((r) => setTimeout(r, 20));

      // Shutdown while messages are queued
      await conductor.shutdown();

      // The first message might complete or be interrupted
      // The queued messages (p2, p3) should be rejected
      const results = await Promise.allSettled([p1, p2, p3]);

      // At least one of the queued messages should be rejected
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('QUEUED event fires for queued messages', () => {
    test('onEvent callback receives QUEUED event when message is queued', async () => {
      pool = createDelayMockPool(100);
      memory = new MockMemory();
      conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as MemoryInterface);
      await conductor.initialize();
      const def = makeAgent({ id: 'worker', name: 'Worker', role: 'worker' });
      await pool.create(def);

      const events: Array<{ type: string; content?: string }> = [];
      const eventTracker: OnConductorEvent = (event) => {
        events.push({ type: event.type, content: event.content });
      };

      const msg1 = makeMessage({ content: 'First', targetAgentId: 'worker' });
      const msg2 = makeMessage({ content: 'Second', targetAgentId: 'worker' });

      // Fire both — second should queue and emit QUEUED event
      const [res1, res2] = await Promise.all([
        conductor.handleMessage(msg1, eventTracker),
        conductor.handleMessage(msg2, eventTracker),
      ]);

      expect(res1.content).toBeTruthy();
      expect(res2.content).toBeTruthy();

      // There should be at least one QUEUED event
      const queuedEvents = events.filter((e) => e.type === ConductorEventType.QUEUED);
      expect(queuedEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('maxQueueDepth enforcement', () => {
    test('rejects messages when queue is full', async () => {
      pool = createDelayMockPool(200);
      memory = new MockMemory();
      conductor = new Conductor(
        pool as unknown as AgentPool,
        memory as unknown as MemoryInterface,
        undefined,
        {
          maxQueueDepth: 2,
        },
      );
      await conductor.initialize();
      const def = makeAgent({ id: 'worker', name: 'Worker', role: 'worker' });
      await pool.create(def);

      const msg1 = makeMessage({ content: 'First', targetAgentId: 'worker' });
      const msg2 = makeMessage({ content: 'Second', targetAgentId: 'worker' });
      const msg3 = makeMessage({ content: 'Third', targetAgentId: 'worker' });
      const msg4 = makeMessage({ content: 'Fourth — should be rejected', targetAgentId: 'worker' });

      // Fire first three — first processes, second and third queue (depth=2)
      const p1 = conductor.handleMessage(msg1);
      const p2 = conductor.handleMessage(msg2);
      const p3 = conductor.handleMessage(msg3);

      // Fourth should throw QueueFullError synchronously
      expect(() => conductor.handleMessage(msg4)).toThrow(QueueFullError);

      await Promise.all([p1, p2, p3]);
    });
  });

  describe('error isolation between queued messages', () => {
    test('error in one queued message does not break subsequent messages', async () => {
      pool = createDelayMockPool(50);
      memory = new MockMemory();
      conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as MemoryInterface);
      await conductor.initialize();
      const def = makeAgent({ id: 'worker', name: 'Worker', role: 'worker' });
      await pool.create(def);

      // Make the first sendMessage call throw, second succeeds
      let sendCallCount = 0;
      pool.sendMessage = mock(async (_id: string, _msg: string) => {
        sendCallCount++;
        await new Promise((r) => setTimeout(r, 50));
        if (sendCallCount === 1) throw new Error('First message failed');
        return `Success ${sendCallCount}`;
      });

      const msg1 = makeMessage({ content: 'Will fail', targetAgentId: 'worker' });
      const msg2 = makeMessage({ content: 'Should succeed', targetAgentId: 'worker' });

      const results = await Promise.allSettled([
        conductor.handleMessage(msg1),
        conductor.handleMessage(msg2),
      ]);

      // First message may fail (due to delegation error) — that's ok
      // The critical test: second message should still process and succeed
      // Without a queue, both messages race — the second might fail too or behave unpredictably
      const secondResult = results[1];
      expect(secondResult.status).toBe('fulfilled');
      if (secondResult.status === 'fulfilled') {
        expect(secondResult.value.content).toBeTruthy();
      }
    });
  });
});
