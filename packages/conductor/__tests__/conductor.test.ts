import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AgentPool } from '@autonomy/agent-manager';
import type { Memory } from '@autonomy/memory';
import {
  type AgentDefinition,
  AgentOwner,
  type AgentRuntimeInfo,
  AgentStatus,
} from '@autonomy/shared';
import { Conductor } from '../src/conductor.ts';
import {
  ApprovalRequiredError,
  ConductorNotInitializedError,
  PermissionDeniedError,
} from '../src/errors.ts';
import type { RouterFn } from '../src/types.ts';
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
    conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
  });

  describe('initialization', () => {
    test('throws ConductorNotInitializedError if handleMessage called before init', async () => {
      try {
        await conductor.handleMessage(makeMessage());
        expect(true).toBe(false);
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
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ConductorNotInitializedError);
      }
    });
  });

  describe('handleMessage — basic flow', () => {
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

    test('includes a route decision', async () => {
      const response = await conductor.handleMessage(makeMessage());
      const routeDecision = response.decisions.find((d) => d.action === 'route');
      expect(routeDecision).toBeDefined();
    });

    test('handles message when no agents exist (fallback)', async () => {
      const response = await conductor.handleMessage(makeMessage());
      expect(response.content).toBe('No agents available to handle this request.');
    });

    test('delegates to single agent when one is available', async () => {
      const def = makeAgent({ id: 'test-agent', name: 'Test Agent', role: 'test' });
      await pool.create(def);
      pool.setSendResponse('Agent handled it');

      const msg = makeMessage({ targetAgentId: 'test-agent' });
      const response = await conductor.handleMessage(msg);
      expect(response.content).toBe('Agent handled it');
      expect(response.agentId).toBe('test-agent');
    });

    test('stores conversation in memory after handling', async () => {
      await conductor.handleMessage(makeMessage({ content: 'Hello world' }));
      expect(memory.storeCalls.length).toBe(1);
      expect(memory.storeCalls[0].content).toBe('Hello world');
    });

    test('includes store_memory decision', async () => {
      const response = await conductor.handleMessage(makeMessage());
      const storeDecision = response.decisions.find((d) => d.action === 'store_memory');
      expect(storeDecision).toBeDefined();
    });
  });

  describe('handleMessage — memory integration', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('searches memory for context (calls search)', async () => {
      await conductor.handleMessage(makeMessage({ content: 'test query' }));
      expect(memory.searchCalls.length).toBe(1);
      expect(memory.searchCalls[0].query).toBe('test query');
    });

    test('continues when memory search fails', async () => {
      memory.setShouldThrow(true);
      // Should not throw — memory failures are non-fatal
      const response = await conductor.handleMessage(makeMessage());
      expect(response).toBeDefined();
      expect(response.content).toBeTruthy();
    });

    test('continues when memory store fails', async () => {
      // First search succeeds, then make store fail
      memory.store = async () => {
        throw new Error('Store failed');
      };

      const response = await conductor.handleMessage(makeMessage());
      expect(response).toBeDefined();
      // No store_memory decision since it failed
      const storeDecision = response.decisions.find((d) => d.action === 'store_memory');
      expect(storeDecision).toBeUndefined();
    });
  });

  describe('handleMessage — routing with agents', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('routes to targeted agent by id', async () => {
      const def = makeAgent({ id: 'specific', name: 'Specific Agent' });
      await pool.create(def);
      pool.setSendResponse('Specific response');

      const msg = makeMessage({ targetAgentId: 'specific' });
      const response = await conductor.handleMessage(msg);
      expect(response.content).toBe('Specific response');
      expect(response.agentId).toBe('specific');
    });

    test('delegates via keyword routing', async () => {
      const def = makeAgent({ id: 'analyzer', name: 'Data Analyzer', role: 'data analysis' });
      await pool.create(def);
      pool.setSendResponse('Analysis complete');

      const msg = makeMessage({ content: 'Please analyze this data' });
      const response = await conductor.handleMessage(msg);
      expect(response.content).toBe('Analysis complete');
    });
  });

  describe('handleMessage — multi-agent pipeline', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('executes pipeline with multiple agents', async () => {
      // Create a custom router that returns multiple agents
      conductor.setRouter(async (_msg, agents) => ({
        agentIds: agents.map((a) => a.id),
        reason: 'Multi-agent pipeline',
      }));

      await pool.create(makeAgent({ id: 'a1', name: 'Agent 1' }));
      await pool.create(makeAgent({ id: 'a2', name: 'Agent 2' }));
      pool.setSendResponse('Pipeline result');

      const response = await conductor.handleMessage(makeMessage());
      expect(response.content).toContain('Pipeline result');
      const synthesize = response.decisions.find((d) => d.action === 'synthesize');
      expect(synthesize).toBeDefined();
    });
  });

  describe('handleMessage — create agent on demand', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('creates agent when router requests it', async () => {
      conductor.setRouter(async () => ({
        agentIds: [],
        createAgent: { name: 'New Worker', role: 'worker', systemPrompt: 'Do work' },
        reason: 'Need new agent',
      }));
      pool.setSendResponse('New agent result');

      const response = await conductor.handleMessage(makeMessage());
      expect(pool.create).toHaveBeenCalled();
      const createDecision = response.decisions.find((d) => d.action === 'create_agent');
      expect(createDecision).toBeDefined();
      expect(response.content).toBe('New agent result');
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
      const c = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
      try {
        await c.createAgent({ name: 'X', role: 'x', systemPrompt: 'x' });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ConductorNotInitializedError);
      }
    });
  });

  describe('deleteAgent', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('deletes conductor-owned agent', async () => {
      const def = makeAgent({ id: 'to-delete', owner: AgentOwner.CONDUCTOR });
      await pool.create(def);

      await conductor.deleteAgent('to-delete');
      expect(pool.remove).toHaveBeenCalledWith('to-delete');
    });

    test('silently returns when agent not found', async () => {
      await conductor.deleteAgent('nonexistent');
      // Should not throw
    });

    test('throws ApprovalRequiredError for user-owned agent', async () => {
      const def = makeAgent({ id: 'user-agent', owner: AgentOwner.USER });
      await pool.create(def);

      try {
        await conductor.deleteAgent('user-agent');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalRequiredError);
      }
    });

    test('throws PermissionDeniedError for system agent', async () => {
      const def = makeAgent({ id: 'system-agent', owner: AgentOwner.SYSTEM });
      await pool.create(def);

      try {
        await conductor.deleteAgent('system-agent');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(PermissionDeniedError);
      }
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

  describe('setRouter / resetRouter', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('uses custom router after setRouter', async () => {
      const customRouter: RouterFn = async () => ({
        agentIds: [],
        reason: 'Custom router says no agents',
      });
      conductor.setRouter(customRouter);

      const response = await conductor.handleMessage(makeMessage());
      expect(response.decisions[0].reason).toBe('Custom router says no agents');
    });

    test('restores default after resetRouter', async () => {
      conductor.setRouter(async () => ({
        agentIds: [],
        reason: 'Custom',
      }));
      conductor.resetRouter();

      const response = await conductor.handleMessage(makeMessage());
      // Default router won't return "Custom"
      expect(response.decisions[0].reason).not.toBe('Custom');
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

  describe('pipeline behavior (via handleMessage)', () => {
    beforeEach(async () => {
      await conductor.initialize();
    });

    test('executes steps sequentially in pipeline', async () => {
      conductor.setRouter(async (_msg, agents) => ({
        agentIds: agents.map((a) => a.id),
        reason: 'Multi-agent pipeline',
      }));

      const calls: string[] = [];
      await pool.create(makeAgent({ id: 'a1', name: 'Agent 1' }));
      await pool.create(makeAgent({ id: 'a2', name: 'Agent 2' }));
      pool.sendMessage = mock(async (id: string, _msg: string) => {
        calls.push(id);
        return `Result from ${id}`;
      });

      const response = await conductor.handleMessage(makeMessage());
      expect(calls).toEqual(['a1', 'a2']);
      expect(response.content).toContain('Result from a1');
      expect(response.content).toContain('Result from a2');
    });

    test('continues pipeline on partial failure', async () => {
      conductor.setRouter(async (_msg, agents) => ({
        agentIds: agents.map((a) => a.id),
        reason: 'Pipeline',
      }));

      await pool.create(makeAgent({ id: 'a1', name: 'Agent 1' }));
      await pool.create(makeAgent({ id: 'a2', name: 'Agent 2' }));
      let callCount = 0;
      pool.sendMessage = mock(async (id: string) => {
        callCount++;
        if (callCount === 1) throw new Error('First step failed');
        return `Result from ${id}`;
      });

      const response = await conductor.handleMessage(makeMessage());
      // Pipeline should still succeed with partial results
      expect(response.content).toContain('Result from a2');
      const delegateDecisions = response.decisions.filter((d) => d.action === 'delegate');
      expect(delegateDecisions.length).toBe(2);
    });

    test('reports all-failed pipeline', async () => {
      conductor.setRouter(async (_msg, agents) => ({
        agentIds: agents.map((a) => a.id),
        reason: 'Pipeline',
      }));

      await pool.create(makeAgent({ id: 'a1', name: 'Agent 1' }));
      await pool.create(makeAgent({ id: 'a2', name: 'Agent 2' }));
      pool.sendMessage = mock(async () => {
        throw new Error('Failed');
      });

      const response = await conductor.handleMessage(makeMessage());
      expect(response.content).toContain('All pipeline steps failed');
    });

    test('passes accumulated context to subsequent pipeline steps', async () => {
      conductor.setRouter(async (_msg, agents) => ({
        agentIds: agents.map((a) => a.id),
        reason: 'Pipeline',
      }));

      await pool.create(makeAgent({ id: 'a1', name: 'Agent 1' }));
      await pool.create(makeAgent({ id: 'a2', name: 'Agent 2' }));
      const receivedMessages: string[] = [];
      pool.sendMessage = mock(async (_id: string, msg: string) => {
        receivedMessages.push(msg);
        return 'step done';
      });

      await conductor.handleMessage(makeMessage({ content: 'Do work' }));
      // Second step should receive accumulated context from first
      expect(receivedMessages[1]).toContain('Previous results');
      expect(receivedMessages[1]).toContain('step done');
    });
  });
});
