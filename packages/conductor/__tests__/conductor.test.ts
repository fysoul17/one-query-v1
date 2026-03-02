import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AgentPool } from '@autonomy/agent-manager';
import {
  type AgentDefinition,
  AgentOwner,
  type AgentRuntimeInfo,
  AgentStatus,
} from '@autonomy/shared';
import type { MemoryInterface } from '@pyx-memory/client';
import { Conductor } from '../src/conductor.ts';
import { ConductorNotInitializedError } from '../src/errors.ts';
import { makeAgent, makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

// Minimal mock pool that tracks create/remove/sendMessage calls
function createMockPool() {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();
  let sendResponse = 'Mock agent response';

  return {
    setSendResponse(r: string) {
      sendResponse = r;
    },
    create: mock(async (definition: AgentDefinition) => {
      const runtime = {
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
    sendMessage: mock(async (_id: string, _msg: string) => sendResponse),
    shutdown: mock(async () => {
      agents.clear();
    }),
    _agents: agents,
  };
}

describe('Conductor', () => {
  let conductor: Conductor;
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
    conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as MemoryInterface);
  });

  describe('initialization', () => {
    test('throws ConductorNotInitializedError if handleMessage called before init', async () => {
      try {
        await conductor.handleMessage(makeMessage());
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConductorNotInitializedError);
      }
    });

    test('initialize succeeds', async () => {
      await conductor.initialize();
      // Should not throw on second init
      await conductor.initialize();
    });

    test('shutdown resets initialized state', async () => {
      await conductor.initialize();
      await conductor.shutdown();

      try {
        await conductor.handleMessage(makeMessage());
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConductorNotInitializedError);
      }
    });
  });

  describe('handleMessage — no backend (fallback)', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('returns a ConductorResponse with decisions', async () => {
      const response = await conductor.handleMessage(makeMessage());
      expect(response).toBeDefined();
      expect(response.content).toBeTruthy();
      expect(response.decisions).toBeInstanceOf(Array);
      expect(response.decisions.length).toBeGreaterThan(0);
    });

    test('returns fallback when no backend is configured', async () => {
      const response = await conductor.handleMessage(makeMessage());
      expect(response.content).toContain('Conductor');
    });

    test('stores conversation in memory after handling', async () => {
      await conductor.handleMessage(makeMessage({ content: 'Hello world' }));
      // Stores both user message and assistant response
      expect(memory.storeCalls.length).toBe(2);
      expect(memory.storeCalls[0].content).toBe('Hello world');
    });

    test('includes store_memory decision', async () => {
      const response = await conductor.handleMessage(makeMessage());
      const storeDecision = response.decisions.find((d) => d.action === 'store_memory');
      expect(storeDecision).toBeDefined();
    });
  });

  describe('handleMessage — delegation to targeted agent', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('delegates to targeted agent by id', async () => {
      const def = makeAgent({ id: 'test-agent', name: 'Test Agent', role: 'test' });
      await pool.create(def);
      pool.setSendResponse('Agent handled it');

      const msg = makeMessage({ targetAgentId: 'test-agent' });
      const response = await conductor.handleMessage(msg);
      expect(response.content).toBe('Agent handled it');
      expect(response.agentId).toBe('test-agent');
    });

    test('includes delegate decision when targeting agent', async () => {
      const def = makeAgent({ id: 'specific', name: 'Specific Agent' });
      await pool.create(def);
      pool.setSendResponse('Response');

      const msg = makeMessage({ targetAgentId: 'specific' });
      const response = await conductor.handleMessage(msg);
      const delegateDecision = response.decisions.find((d) => d.action === 'delegate');
      expect(delegateDecision).toBeDefined();
      expect(delegateDecision?.targetAgentId).toBe('specific');
    });
  });

  describe('handleMessage — memory integration', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('searches memory for context', async () => {
      await conductor.handleMessage(makeMessage({ content: 'test query' }));
      expect(memory.searchCalls.length).toBe(1);
      expect(memory.searchCalls[0].query).toBe('test query');
    });

    test('continues when memory search fails', async () => {
      memory.setShouldThrow(true);
      const response = await conductor.handleMessage(makeMessage());
      expect(response).toBeDefined();
      expect(response.content).toBeTruthy();
    });

    test('continues when memory store fails', async () => {
      memory.store = async () => {
        throw new Error('Store failed');
      };

      const response = await conductor.handleMessage(makeMessage());
      expect(response).toBeDefined();
      const storeDecision = response.decisions.find((d) => d.action === 'store_memory');
      expect(storeDecision).toBeUndefined();
    });
  });

  describe('createAgent', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('creates conductor-owned agent', async () => {
      const info = await conductor.createAgent({
        name: 'Worker',
        role: 'worker',
        systemPrompt: 'Do tasks',
      });
      expect(info.name).toBe('Worker');
      expect(info.owner).toBe(AgentOwner.CONDUCTOR);
      expect(pool.create).toHaveBeenCalled();
    });

    test('throws if not initialized', async () => {
      const c = new Conductor(pool as unknown as AgentPool, memory as unknown as MemoryInterface);
      try {
        await c.createAgent({ name: 'X', role: 'x', systemPrompt: 'x' });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConductorNotInitializedError);
      }
    });
  });

  describe('deleteAgent', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('deletes agent', async () => {
      const def = makeAgent({ id: 'to-delete', owner: AgentOwner.CONDUCTOR });
      await pool.create(def);

      await conductor.deleteAgent('to-delete');
      expect(pool.remove).toHaveBeenCalledWith('to-delete');
    });
  });

  describe('listAgents', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('returns list from pool', () => {
      const agents = conductor.listAgents();
      expect(agents).toBeInstanceOf(Array);
      expect(pool.list).toHaveBeenCalled();
    });
  });

  describe('sendToAgent', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('sends message directly to agent via pool', async () => {
      pool.setSendResponse('Direct response');
      const result = await conductor.sendToAgent('agent-1', 'Hello');
      expect(result).toBe('Direct response');
      expect(pool.sendMessage).toHaveBeenCalledWith('agent-1', 'Hello');
    });
  });

  describe('activity tracking', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('records activity on handleMessage', async () => {
      await conductor.handleMessage(makeMessage());
      const activity = conductor.getActivity();
      expect(activity.length).toBeGreaterThan(0);
    });

    test('getActivity returns recent entries', async () => {
      await conductor.handleMessage(makeMessage({ senderName: 'Alice' }));
      const activity = conductor.getActivity(10);
      expect(activity.length).toBeGreaterThan(0);
    });

    test('getAgentActivity filters by agent', async () => {
      const def = makeAgent({ id: 'tracked', name: 'Tracked Agent' });
      await pool.create(def);
      pool.setSendResponse('OK');

      await conductor.sendToAgent('tracked', 'Test');
      const agentActivity = conductor.getAgentActivity('tracked');
      expect(agentActivity.length).toBeGreaterThan(0);
    });
  });

  describe('setCronManager', () => {
    test('accepts a CronManager-like object', async () => {
      await conductor.initialize();
      const mockCron = { create: mock(async () => ({ id: 'c1', name: 'test' })) };
      // Should not throw
      conductor.setCronManager(mockCron as never);
    });
  });

  describe('searchMemory', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('searches memory via the public searchMemory method', async () => {
      const result = await conductor.searchMemory('test query', 3);
      expect(result).toBeDefined();
      expect(memory.searchCalls.length).toBe(1);
      expect(memory.searchCalls[0].query).toBe('test query');
      expect(memory.searchCalls[0].limit).toBe(3);
    });

    test('returns null when memory search throws', async () => {
      memory.setShouldThrow(true);
      const result = await conductor.searchMemory('test', 5);
      expect(result).toBeNull();
    });
  });

  describe('system context in augmented prompt', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('delegates to agent with system-context in augmented message', async () => {
      const def = makeAgent({ id: 'ctx-agent', name: 'Context Agent', role: 'test' });
      await pool.create(def);
      pool.setSendResponse('OK');

      await conductor.handleMessage(makeMessage({ targetAgentId: 'ctx-agent' }));

      // The augmented message sent to pool.sendMessage should contain system-context
      const sentMessage = pool.sendMessage.mock.calls[0]?.[1] as string;
      expect(sentMessage).toContain('<system-context>');
      expect(sentMessage).toContain('agent-forge');
    });
  });
});
