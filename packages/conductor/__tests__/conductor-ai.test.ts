import { describe, expect, mock, test } from 'bun:test';
import type { AgentPool, BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import { MaxAgentsReachedError } from '@autonomy/agent-manager';
import type { Memory } from '@autonomy/memory';
import {
  type AgentDefinition,
  AgentOwner,
  type AgentRuntimeInfo,
  AgentStatus,
} from '@autonomy/shared';
import { Conductor } from '../src/conductor.ts';
import { DelegationDepthError } from '../src/errors.ts';
import { type ConductorEvent, ConductorEventType } from '../src/types.ts';
import { makeAgent, makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

// ---------------------------------------------------------------------------
// Mock pool with MaxAgentsReachedError support
// ---------------------------------------------------------------------------

function createMockPool(options?: { maxAgents?: number }) {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();
  let sendResponse = 'Mock agent response';
  const maxAgents = options?.maxAgents ?? 100;

  return {
    setSendResponse(r: string) {
      sendResponse = r;
    },
    create: mock(async (definition: AgentDefinition) => {
      if (agents.size >= maxAgents) {
        throw new MaxAgentsReachedError(maxAgents);
      }
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
    sendMessage: mock(async (_id: string, _msg: string) => sendResponse),
    shutdown: mock(async () => {
      agents.clear();
    }),
    _agents: agents,
  };
}

// ---------------------------------------------------------------------------
// Mock CLIBackend
// ---------------------------------------------------------------------------

function createMockBackend(aiResponse: string | Error): CLIBackend {
  const backendProcess: BackendProcess = {
    send: async (_msg: string) => {
      if (aiResponse instanceof Error) throw aiResponse;
      return aiResponse;
    },
    stop: async () => {},
    get alive() {
      return !(aiResponse instanceof Error);
    },
  };

  return {
    name: 'claude' as const,
    capabilities: {
      supportsSystemPrompt: true,
      supportsTools: true,
      supportsPipes: true,
      supportsCustomTools: false,
    },
    spawn: async () => backendProcess,
  } as unknown as CLIBackend;
}

// ---------------------------------------------------------------------------
// Backward compat: no AI backend
// ---------------------------------------------------------------------------

describe('Conductor without AI backend (backward compat)', () => {
  test('returns actionable fallback when no agents and no backend', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    // No backend provided — uses keyword router
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage());
    // Improved fallback: actionable message instead of dead-end
    expect(response.content).toContain('Conductor');
    expect(response.content).toContain('agent');
  });

  test('decision action is "route" not "ai_route" without backend', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage());
    const routeDecision = response.decisions.find((d) => d.action === 'route');
    expect(routeDecision).toBeDefined();
    expect(response.decisions.find((d) => d.action === 'ai_route')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Conductor with AI backend
// ---------------------------------------------------------------------------

describe('Conductor with AI backend', () => {
  test('creates agent when pool is empty (KEY TEST)', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const backend = createMockBackend(
      JSON.stringify({
        agentIds: [],
        createAgent: {
          name: 'Auto Assistant',
          role: 'general assistant',
          systemPrompt: 'Help users with their tasks.',
        },
        reason: 'No agents available, creating specialist',
      }),
    );
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();
    pool.setSendResponse('AI-created agent response');

    const response = await conductor.handleMessage(
      makeMessage({ content: 'Help me with testing' }),
    );

    expect(response.content).toBe('AI-created agent response');
    expect(response.content).not.toBe('No agents available to handle this request.');
    expect(pool.create).toHaveBeenCalled();

    const createDecision = response.decisions.find((d) => d.action === 'create_agent');
    expect(createDecision).toBeDefined();
  });

  test('created agent is conductor-owned and non-persistent', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const backend = createMockBackend(
      JSON.stringify({
        agentIds: [],
        createAgent: { name: 'Worker', role: 'worker', systemPrompt: 'Work.' },
        reason: 'Creating worker',
      }),
    );
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();
    pool.setSendResponse('Done');

    await conductor.handleMessage(makeMessage());

    const createCall = pool.create.mock.calls[0];
    expect(createCall).toBeDefined();
    const definition = createCall?.[0] as AgentDefinition;
    expect(definition.owner).toBe(AgentOwner.CONDUCTOR);
    expect(definition.persistent).toBe(false);
  });

  test('decision action is "ai_route" with backend', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const backend = createMockBackend(
      JSON.stringify({
        agentIds: [],
        createAgent: { name: 'A', role: 'a', systemPrompt: 'a' },
        reason: 'AI routing',
      }),
    );
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();
    pool.setSendResponse('Done');

    const response = await conductor.handleMessage(makeMessage());
    const aiRouteDecision = response.decisions.find((d) => d.action === 'ai_route');
    expect(aiRouteDecision).toBeDefined();
  });

  test('falls back to keyword router when AI backend fails to init', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const failingBackend = {
      name: 'claude' as const,
      capabilities: {
        supportsSystemPrompt: true,
        supportsTools: true,
        supportsPipes: true,
        supportsCustomTools: false,
      },
      spawn: async () => {
        throw new Error('Claude CLI not found');
      },
    } as unknown as CLIBackend;

    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      failingBackend,
    );
    await conductor.initialize(); // Should not throw

    const response = await conductor.handleMessage(makeMessage());
    // Falls back to keyword router → no agents → actionable fallback
    expect(response.content).toContain('Conductor');
    expect(response.content).toContain('agent');
  });

  test('shutdown stops the conductor AI process', async () => {
    const stopMock = mock(async () => {});
    const backendProcess: BackendProcess = {
      send: async () => '{}',
      stop: stopMock,
      get alive() {
        return true;
      },
    };
    const backend = {
      name: 'claude' as const,
      capabilities: {
        supportsSystemPrompt: true,
        supportsTools: true,
        supportsPipes: true,
        supportsCustomTools: false,
      },
      spawn: async () => backendProcess,
    } as unknown as CLIBackend;

    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();
    await conductor.shutdown();

    expect(stopMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ConductorEvent callback (onEvent)
// ---------------------------------------------------------------------------

describe('Conductor onEvent callback', () => {
  test('emits routing event', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const routingEvents = events.filter((e) => e.type === ConductorEventType.ROUTING);
    expect(routingEvents.length).toBeGreaterThan(0);
  });

  test('emits creating_agent and agent_created events when creating', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      createAgent: { name: 'Evented Agent', role: 'test', systemPrompt: 'Test.' },
      reason: 'Testing events',
    }));
    pool.setSendResponse('Done');

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    expect(events.find((e) => e.type === ConductorEventType.CREATING_AGENT)).toBeDefined();
    expect(events.find((e) => e.type === ConductorEventType.AGENT_CREATED)).toBeDefined();
    expect(events.find((e) => e.type === ConductorEventType.DELEGATING)).toBeDefined();
  });

  test('emits delegating event when routing to existing agent', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    await pool.create(makeAgent({ id: 'target', name: 'Target' }));
    pool.setSendResponse('OK');

    const events: ConductorEvent[] = [];
    const msg = makeMessage({ targetAgentId: 'target' });
    await conductor.handleMessage(msg, (e) => events.push(e));

    expect(events.find((e) => e.type === ConductorEventType.DELEGATING)).toBeDefined();
  });

  test('works fine when onEvent is not provided', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    // Should not throw
    const response = await conductor.handleMessage(makeMessage());
    expect(response).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Delegation depth limit
// ---------------------------------------------------------------------------

describe('Conductor delegation depth', () => {
  test('throws DelegationDepthError when depth exceeds max', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      undefined,
      { maxDelegationDepth: 3 },
    );
    await conductor.initialize();

    const msg = makeMessage({ metadata: { delegationDepth: 4 } });

    try {
      await conductor.handleMessage(msg);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(DelegationDepthError);
    }
  });

  test('allows message at exactly max depth', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      undefined,
      { maxDelegationDepth: 3 },
    );
    await conductor.initialize();

    const msg = makeMessage({ metadata: { delegationDepth: 3 } });
    const response = await conductor.handleMessage(msg);
    expect(response).toBeDefined();
  });

  test('defaults to depth 5 when not configured', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    // Depth 5 should work
    const msg5 = makeMessage({ metadata: { delegationDepth: 5 } });
    const response = await conductor.handleMessage(msg5);
    expect(response).toBeDefined();

    // Depth 6 should throw
    const msg6 = makeMessage({ metadata: { delegationDepth: 6 } });
    try {
      await conductor.handleMessage(msg6);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(DelegationDepthError);
    }
  });
});

// ---------------------------------------------------------------------------
// MaxAgents eviction
// ---------------------------------------------------------------------------

describe('Conductor MaxAgents eviction', () => {
  test('evicts idle conductor-owned agent when pool full', async () => {
    const pool = createMockPool({ maxAgents: 1 });
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    // Fill pool with a conductor-owned idle agent
    await pool.create(
      makeAgent({ id: 'old-agent', name: 'Old Agent', owner: AgentOwner.CONDUCTOR }),
    );
    pool.setSendResponse('New agent response');

    conductor.setRouter(async () => ({
      agentIds: [],
      createAgent: { name: 'New Agent', role: 'new', systemPrompt: 'New.' },
      reason: 'Need new agent',
    }));

    const response = await conductor.handleMessage(makeMessage());
    // Old agent should have been evicted and new one created
    expect(response.content).toBe('New agent response');
    expect(pool.remove).toHaveBeenCalledWith('old-agent');
  });

  test('falls back to existing agent when eviction not possible (user-owned)', async () => {
    const pool = createMockPool({ maxAgents: 1 });
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    // Fill pool with a user-owned agent (cannot be evicted)
    await pool.create(makeAgent({ id: 'user-agent', name: 'User Agent', owner: AgentOwner.USER }));
    pool.setSendResponse('Existing agent response');

    conductor.setRouter(async () => ({
      agentIds: [],
      createAgent: { name: 'Overflow', role: 'overflow', systemPrompt: 'Over.' },
      reason: 'Need new agent',
    }));

    const response = await conductor.handleMessage(makeMessage());
    // Should fall back to routing to existing agent
    expect(response.content).toBe('Existing agent response');
    const fallbackDecision = response.decisions.find((d) => d.action === 'ai_fallback');
    expect(fallbackDecision).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Memory context isolation
// ---------------------------------------------------------------------------

describe('Conductor memory context isolation', () => {
  test('wraps memory context in <memory-context> tags', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    memory.setSearchResults({
      entries: [
        {
          id: 'mem-1',
          content: 'Previous conversation about testing',
          type: 'short-term' as const,
          metadata: {},
          createdAt: new Date().toISOString(),
        },
      ],
      totalCount: 1,
      strategy: 'naive' as const,
    });

    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    await pool.create(makeAgent({ id: 'agent-1', name: 'Agent 1' }));

    const receivedMessages: string[] = [];
    pool.sendMessage = mock(async (_id: string, msg: string) => {
      receivedMessages.push(msg);
      return 'OK';
    });

    await conductor.handleMessage(makeMessage({ targetAgentId: 'agent-1' }));

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0]).toContain('<memory-context>');
    expect(receivedMessages[0]).toContain('</memory-context>');
    expect(receivedMessages[0]).toContain('Previous conversation about testing');
  });
});
