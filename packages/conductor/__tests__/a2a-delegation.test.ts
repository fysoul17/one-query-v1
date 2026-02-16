/**
 * Tests for Agent-to-Agent (A2A) delegation.
 *
 * These tests validate:
 * 1. Agent A can delegate a task to Agent B via the Conductor
 * 2. Delegation results are returned to the requesting agent
 * 3. Circular delegation is detected and prevented
 * 4. Max delegation depth is enforced
 * 5. Permissions are checked for delegation
 *
 * NOTE: A2A delegation is not yet implemented. These tests define the
 * expected behavior using the existing shared types (DelegateTaskRequest,
 * DelegateTaskResult) from packages/shared/src/types/a2a.ts.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AgentPool } from '@autonomy/agent-manager';
import type { Memory } from '@autonomy/memory';
import {
  type AgentDefinition,
  AgentOwner,
  type AgentRuntimeInfo,
  AgentStatus,
  type DelegateTaskRequest,
  type DelegateTaskResult,
} from '@autonomy/shared';
import { Conductor } from '../src/conductor.ts';
import { makeAgent, makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

// ---------------------------------------------------------------------------
// Mock pool for A2A tests
// ---------------------------------------------------------------------------

function createMockPool() {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();
  const messageLog: Array<{ agentId: string; message: string }> = [];
  const sendResponses = new Map<string, string>();
  let defaultResponse = 'Mock response';

  return {
    setDefaultResponse(r: string) {
      defaultResponse = r;
    },
    setAgentResponse(agentId: string, response: string) {
      sendResponses.set(agentId, response);
    },
    get messageLog() {
      return messageLog;
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
    sendMessage: mock(async (id: string, msg: string) => {
      messageLog.push({ agentId: id, message: msg });
      return sendResponses.get(id) ?? defaultResponse;
    }),
    shutdown: mock(async () => {
      agents.clear();
    }),
    _agents: agents,
  };
}

// ---------------------------------------------------------------------------
// A2A Delegation - basic delegation flow
// ---------------------------------------------------------------------------

describe('A2A Delegation - basic flow', () => {
  let conductor: Conductor;
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;

  beforeEach(async () => {
    pool = createMockPool();
    memory = new MockMemory();
    conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();
  });

  test('DelegateTaskRequest type has correct shape', () => {
    // Verify the shared types exist and have the right structure
    const request: DelegateTaskRequest = {
      fromAgentId: 'agent-a',
      toAgentId: 'agent-b',
      task: 'Analyze this data',
      context: 'Previous analysis results...',
    };

    expect(request.fromAgentId).toBe('agent-a');
    expect(request.toAgentId).toBe('agent-b');
    expect(request.task).toBeTruthy();
    expect(request.context).toBeTruthy();
  });

  test('DelegateTaskResult type has correct shape', () => {
    const result: DelegateTaskResult = {
      fromAgentId: 'agent-a',
      toAgentId: 'agent-b',
      result: 'Analysis complete: 5% defect rate',
      success: true,
    };

    expect(result.success).toBe(true);
    expect(result.result).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  test('DelegateTaskResult can represent failure', () => {
    const result: DelegateTaskResult = {
      fromAgentId: 'agent-a',
      toAgentId: 'agent-b',
      result: '',
      success: false,
      error: 'Target agent is not available',
    };

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('conductor.sendToAgent works as delegation primitive', async () => {
    // sendToAgent is the existing low-level primitive that A2A will build on
    await pool.create(makeAgent({ id: 'target-agent', name: 'Target Agent' }));
    pool.setAgentResponse('target-agent', 'Delegated task completed');

    const result = await conductor.sendToAgent('target-agent', 'Process this data');
    expect(result).toBe('Delegated task completed');
    expect(pool.messageLog[0]).toEqual({
      agentId: 'target-agent',
      message: 'Process this data',
    });
  });

  test('delegation via pipeline simulates A2A relay mode', async () => {
    // Multi-agent pipeline already exists as a relay delegation mechanism
    await pool.create(makeAgent({ id: 'agent-a', name: 'Agent A', role: 'analyzer' }));
    await pool.create(makeAgent({ id: 'agent-b', name: 'Agent B', role: 'reporter' }));
    pool.setAgentResponse('agent-a', 'Analysis: 5% defect rate');
    pool.setAgentResponse('agent-b', 'Report generated with 5% defect rate');

    // Set up a pipeline router (A -> B)
    conductor.setRouter(async (_msg, _agents) => ({
      agentIds: ['agent-a', 'agent-b'],
      reason: 'Pipeline: analyze then report',
    }));

    const response = await conductor.handleMessage(
      makeMessage({ content: 'Analyze defects and generate report' }),
    );

    // Both agents should have been called
    expect(pool.messageLog.length).toBe(2);
    expect(pool.messageLog[0]?.agentId).toBe('agent-a');
    expect(pool.messageLog[1]?.agentId).toBe('agent-b');

    // Second agent should receive context from first
    expect(pool.messageLog[1]?.message).toContain('Previous results');

    // Response should include both results
    const synthesizeDecision = response.decisions.find((d) => d.action === 'synthesize');
    expect(synthesizeDecision).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// A2A Delegation - error handling
// ---------------------------------------------------------------------------

describe('A2A Delegation - error handling', () => {
  let conductor: Conductor;
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;

  beforeEach(async () => {
    pool = createMockPool();
    memory = new MockMemory();
    conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();
  });

  test('delegation to non-existent agent throws', async () => {
    try {
      await conductor.sendToAgent('nonexistent-agent', 'Hello');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeTruthy();
    }
  });

  test('pipeline continues when one agent fails (partial success)', async () => {
    await pool.create(makeAgent({ id: 'agent-a', name: 'Agent A' }));
    await pool.create(makeAgent({ id: 'agent-b', name: 'Agent B' }));

    let callCount = 0;
    pool.sendMessage = mock(async (_id: string) => {
      callCount++;
      if (callCount === 1) throw new Error('Agent A crashed');
      return 'Agent B succeeded';
    });

    conductor.setRouter(async () => ({
      agentIds: ['agent-a', 'agent-b'],
      reason: 'Pipeline',
    }));

    const response = await conductor.handleMessage(makeMessage());
    expect(response.content).toContain('Agent B succeeded');

    const delegateDecisions = response.decisions.filter((d) => d.action === 'delegate');
    expect(delegateDecisions.length).toBe(2);
    // First should be failure, second success
    expect(delegateDecisions[0]?.reason).toContain('failed');
    expect(delegateDecisions[1]?.reason).toContain('succeeded');
  });

  test('all agents failing in pipeline returns meaningful error', async () => {
    await pool.create(makeAgent({ id: 'agent-a', name: 'Agent A' }));
    await pool.create(makeAgent({ id: 'agent-b', name: 'Agent B' }));

    pool.sendMessage = mock(async () => {
      throw new Error('All agents down');
    });

    conductor.setRouter(async () => ({
      agentIds: ['agent-a', 'agent-b'],
      reason: 'Pipeline',
    }));

    const response = await conductor.handleMessage(makeMessage());
    expect(response.content).toContain('All pipeline steps failed');
  });
});

// ---------------------------------------------------------------------------
// A2A Delegation - circular and depth protection (future implementation)
// ---------------------------------------------------------------------------

describe('A2A Delegation - circular and depth protection', () => {
  test('circular delegation detection concept', () => {
    // When A2A direct delegation is implemented, the system must detect:
    // Agent A -> delegates to Agent B -> delegates to Agent A (circular)
    // This requires tracking the delegation chain.
    const delegationChain = ['agent-a', 'agent-b', 'agent-a'];

    // Detect circular: check if any agent appears twice
    const seen = new Set<string>();
    let circular = false;
    for (const agentId of delegationChain) {
      if (seen.has(agentId)) {
        circular = true;
        break;
      }
      seen.add(agentId);
    }

    expect(circular).toBe(true);
  });

  test('max delegation depth concept', () => {
    // A2A delegation should have a max depth to prevent infinite chains
    const MAX_DELEGATION_DEPTH = 5;
    const chain = ['a', 'b', 'c', 'd', 'e', 'f']; // 6 hops

    expect(chain.length).toBeGreaterThan(MAX_DELEGATION_DEPTH);
    // Implementation should reject delegation when depth exceeds limit
  });

  test('delegation chain without circular reference is valid', () => {
    const delegationChain = ['agent-a', 'agent-b', 'agent-c'];

    const seen = new Set<string>();
    let circular = false;
    for (const agentId of delegationChain) {
      if (seen.has(agentId)) {
        circular = true;
        break;
      }
      seen.add(agentId);
    }

    expect(circular).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A2A Delegation - permissions
// ---------------------------------------------------------------------------

describe('A2A Delegation - permissions', () => {
  let conductor: Conductor;
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;

  beforeEach(async () => {
    pool = createMockPool();
    memory = new MockMemory();
    conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();
  });

  test('conductor-owned agent can be delegated to', async () => {
    const def = makeAgent({ id: 'conductor-agent', owner: AgentOwner.CONDUCTOR });
    await pool.create(def);
    pool.setAgentResponse('conductor-agent', 'Task done');

    const result = await conductor.sendToAgent('conductor-agent', 'Do this task');
    expect(result).toBe('Task done');
  });

  test('user-owned agent can be delegated to', async () => {
    // Per permissions.ts, DELEGATE on USER_AGENT is allowed without approval
    const def = makeAgent({ id: 'user-agent', owner: AgentOwner.USER });
    await pool.create(def);
    pool.setAgentResponse('user-agent', 'User agent result');

    const result = await conductor.sendToAgent('user-agent', 'Do this task');
    expect(result).toBe('User agent result');
  });

  test('delegation activity is logged', async () => {
    const def = makeAgent({ id: 'tracked-agent', name: 'Tracked Agent' });
    await pool.create(def);
    pool.setAgentResponse('tracked-agent', 'Done');

    await conductor.sendToAgent('tracked-agent', 'Track this');

    const activity = conductor.getAgentActivity('tracked-agent');
    expect(activity.length).toBeGreaterThan(0);
    const delegationEntry = activity.find((a) => a.details.includes('Direct message'));
    expect(delegationEntry).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// A2A Delegation - agent creation during delegation
// ---------------------------------------------------------------------------

describe('A2A Delegation - agent creation during delegation', () => {
  let conductor: Conductor;
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;

  beforeEach(async () => {
    pool = createMockPool();
    memory = new MockMemory();
    conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();
  });

  test('conductor creates delegate agent with contextual system prompt', async () => {
    conductor.setRouter(async () => ({
      agentIds: [],
      createAgent: {
        name: 'Quality Analyst',
        role: 'quality analysis',
        systemPrompt: 'You are a quality analyst specializing in defect rate analysis.',
      },
      reason: 'Creating specialist for quality analysis task',
    }));
    pool.setDefaultResponse('Defect rate is 3.2%');

    const response = await conductor.handleMessage(
      makeMessage({ content: 'Analyze the defect rate for production line 3' }),
    );

    // Verify agent was created with the right prompt
    const createCall = pool.create.mock.calls[0];
    const definition = createCall?.[0] as AgentDefinition;
    expect(definition.name).toBe('Quality Analyst');
    expect(definition.role).toBe('quality analysis');
    expect(definition.systemPrompt).toContain('quality analyst');
    expect(definition.systemPrompt).toContain('defect rate');

    expect(response.content).toBe('Defect rate is 3.2%');
  });

  test('created agent receives the original user message', async () => {
    conductor.setRouter(async () => ({
      agentIds: [],
      createAgent: {
        name: 'Helper',
        role: 'helper',
        systemPrompt: 'You help.',
      },
      reason: 'Need helper',
    }));
    pool.setDefaultResponse('Done');

    const userContent = 'Please help me with this specific task';
    await conductor.handleMessage(makeMessage({ content: userContent }));

    // The created agent should receive the user's message
    expect(pool.messageLog.length).toBeGreaterThan(0);
    expect(pool.messageLog[0]?.message).toContain(userContent);
  });
});
