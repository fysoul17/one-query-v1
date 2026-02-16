import { describe, expect, mock, test } from 'bun:test';
import type { AgentPool, BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import type { Memory } from '@autonomy/memory';
import { type AgentDefinition, type AgentRuntimeInfo, AgentStatus } from '@autonomy/shared';
import { Conductor } from '../src/conductor.ts';
import { type ConductorEvent, ConductorEventType } from '../src/types.ts';
import { makeAgent, makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

// ---------------------------------------------------------------------------
// Mock pool (same pattern as conductor-ai.test.ts)
// ---------------------------------------------------------------------------

function createMockPool() {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();
  let sendResponse = 'Mock agent response';

  return {
    setSendResponse(r: string) {
      sendResponse = r;
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
    sendMessage: mock(async (_id: string, _msg: string) => sendResponse),
    shutdown: mock(async () => {
      agents.clear();
    }),
    _agents: agents,
  };
}

// ---------------------------------------------------------------------------
// Mock CLIBackend — supports tracking send calls for direct response verification
// ---------------------------------------------------------------------------

function createMockBackend(options: { routingResponse: string; directResponse?: string }): {
  backend: CLIBackend;
  sendMock: ReturnType<typeof mock>;
} {
  let callCount = 0;
  const sendMock = mock(async (_msg: string) => {
    callCount++;
    // First call is the routing prompt; subsequent calls are direct response generation
    if (callCount === 1) return options.routingResponse;
    return options.directResponse ?? 'Conductor direct response';
  });

  const backendProcess: BackendProcess = {
    send: sendMock,
    stop: async () => {},
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

  return { backend, sendMock };
}

/**
 * Simpler backend where every send() returns the same string.
 * Used for tests that set a custom router (bypassing the AI routing call).
 */
function createSimpleBackend(response: string | Error): {
  backend: CLIBackend;
  sendMock: ReturnType<typeof mock>;
} {
  const sendMock = mock(async (_msg: string) => {
    if (response instanceof Error) throw response;
    return response;
  });

  const backendProcess: BackendProcess = {
    send: sendMock,
    stop: async () => {},
    get alive() {
      return !(response instanceof Error);
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

  return { backend, sendMock };
}

// ===========================================================================
// TEST SUITE: Conductor Direct Response
// ===========================================================================

describe('Conductor direct response — reproduction tests', () => {
  test('REPRODUCTION: empty pool + defaultRouter returns hardcoded "No agents available" (THIS IS THE BUG)', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage({ content: 'hi' }));

    // BUG: This currently returns the hardcoded string.
    // EXPECTED: The conductor should respond directly with something meaningful,
    // not a dead-end error message.
    expect(response.content).not.toBe('No agents available to handle this request.');
    expect(response.content.length).toBeGreaterThan(0);
  });

  test('REPRODUCTION: with AI backend, conductor should have a path to respond directly instead of only delegating', async () => {
    // AI router decides "direct response" but current schema has no way to express it.
    // The AI returns directResponse: true in its JSON, but resolveRoutingResult ignores it,
    // falls back to defaultRouter → empty pool → "No agents available"
    const { backend } = createMockBackend({
      routingResponse: JSON.stringify({
        agentIds: [],
        directResponse: true,
        reason: 'Simple greeting — no specialist agent needed',
      }),
      directResponse: 'Hello! I am the Conductor. How can I help you today?',
    });
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage({ content: 'hi' }));

    // EXPECTED: conductor uses backendProcess.send() to generate a direct response
    // ACTUAL: falls back to "No agents available"
    expect(response.content).not.toBe('No agents available to handle this request.');
    expect(response.content).toContain('Hello');
  });
});

describe('Conductor direct response — RoutingResult with directResponse boolean', () => {
  test('dispatch() handles RoutingResult with directResponse: true by calling backendProcess.send()', async () => {
    const { backend, sendMock } = createSimpleBackend(
      'I can help you directly without creating an agent.',
    );
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    // Custom router returns directResponse: true (boolean, not string)
    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Simple request handled by conductor',
    }));

    const response = await conductor.handleMessage(makeMessage({ content: 'What time is it?' }));

    // dispatch() should detect directResponse: true and call backendProcess.send()
    // to generate the actual response text
    expect(response.content).toBe('I can help you directly without creating an agent.');
    expect(response.agentId).toBeUndefined();
    // backendProcess.send() should have been called (once for routing init, once for direct response)
    // With setRouter override, only the direct response call matters
    expect(sendMock).toHaveBeenCalled();
  });

  test('directResponse: true triggers backendProcess.send() and returns its result', async () => {
    const { backend, sendMock } = createSimpleBackend('Conductor responding directly via AI.');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Direct response preferred',
    }));

    const response = await conductor.handleMessage(makeMessage());
    expect(response.content).toBe('Conductor responding directly via AI.');
    expect(sendMock).toHaveBeenCalled();
  });

  test('directResponse decision is recorded with action "direct_response"', async () => {
    const { backend } = createSimpleBackend('Direct answer here.');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Handled directly',
    }));

    const response = await conductor.handleMessage(makeMessage());
    const directDecision = response.decisions.find((d) => d.action === 'direct_response');
    expect(directDecision).toBeDefined();
    expect(directDecision?.reason).toContain('direct');
  });

  test('directResponse: false is treated as not requesting direct response', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: false,
      reason: 'Explicitly not direct',
    }));

    const response = await conductor.handleMessage(makeMessage());

    // directResponse: false should NOT trigger direct response path
    // Falls through to the fallback (same as no directResponse field)
    const directDecision = response.decisions.find((d) => d.action === 'direct_response');
    expect(directDecision).toBeUndefined();
  });
});

describe('Conductor direct response — AI router integration', () => {
  test('AI router can return directResponse: true for simple queries', async () => {
    // AI routing call returns JSON with directResponse: true
    // Then dispatch() calls backendProcess.send() again for the actual response
    const { backend } = createMockBackend({
      routingResponse: JSON.stringify({
        agentIds: [],
        directResponse: true,
        reason: 'Simple greeting, no specialist needed',
      }),
      directResponse: 'Hi there! I am the Conductor. What would you like to work on?',
    });
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage({ content: 'hello' }));

    // AI router parses directResponse: true → dispatch calls backendProcess.send()
    expect(response.content).toBe('Hi there! I am the Conductor. What would you like to work on?');
    expect(response.content).not.toBe('No agents available to handle this request.');
  });

  test('AI router resolveRoutingResult handles directResponse: true in parsed JSON', async () => {
    const { backend } = createMockBackend({
      routingResponse: JSON.stringify({
        agentIds: [],
        directResponse: true,
        reason: 'Factual question answered directly',
      }),
      directResponse: 'The answer to your question is 42.',
    });
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    const response = await conductor.handleMessage(
      makeMessage({ content: 'What is the meaning of life?' }),
    );

    expect(response.content).toBe('The answer to your question is 42.');
    // Should not have created any agents
    expect(pool.create).not.toHaveBeenCalled();
  });
});

describe('Conductor direct response — event emission', () => {
  test('emits RESPONDING event when conductor responds directly', async () => {
    const { backend } = createSimpleBackend('Direct response content.');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Responding directly',
    }));

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    // Should emit a RESPONDING event type
    const respondingEvent = events.find((e) => e.type === ConductorEventType.RESPONDING);
    expect(respondingEvent).toBeDefined();
    expect(respondingEvent?.content).toBeDefined();
  });

  test('ConductorEventType includes RESPONDING constant', () => {
    // The RESPONDING event type should exist
    expect(ConductorEventType.RESPONDING).toBeDefined();
    expect(ConductorEventType.RESPONDING).toBe('responding');
  });
});

describe('Conductor direct response — edge cases', () => {
  test('no AI backend AND empty pool: hardcoded fallback should be actionable (not dead-end)', async () => {
    // Level 6 in dispatch chain: no backendProcess at all — genuinely cannot generate AI response.
    // But the hardcoded fallback string should still be actionable, not a dead-end.
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage({ content: 'Help me' }));

    // The fallback should guide the user, not just say "no agents"
    expect(response.content).not.toBe('No agents available to handle this request.');
    expect(response.content.length).toBeGreaterThan(10);
  });

  test('WITH AI backend but routing fails: defense-in-depth fallback uses backendProcess directly', async () => {
    // Level 5 in dispatch chain: AI router returned no useful result (agentIds empty,
    // no createAgent, directResponse not set), BUT the backendProcess is alive.
    // The conductor should use backendProcess.send() as a last-resort AI fallback.
    const { backend, sendMock } = createSimpleBackend('I can help you with that!');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    // Override router to simulate total routing failure (no agents, no createAgent, no directResponse)
    conductor.setRouter(async () => ({
      agentIds: [],
      reason: 'No suitable routing found',
    }));

    const response = await conductor.handleMessage(makeMessage({ content: 'Help me please' }));

    // Defense-in-depth: conductor should use its backendProcess to generate a response
    expect(response.content).not.toBe('No agents available to handle this request.');
    expect(response.content).toBe('I can help you with that!');
    expect(sendMock).toHaveBeenCalled();
  });

  test('WITH AI backend but backendProcess.send fails in fallback: returns improved error', async () => {
    // Level 5 attempt fails — backendProcess.send throws.
    // Should still provide an actionable fallback, not the old dead-end string.
    const { backend } = createSimpleBackend(new Error('Backend unavailable'));
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      reason: 'Routing failed',
    }));

    const response = await conductor.handleMessage(makeMessage({ content: 'hi' }));

    // Even when defense-in-depth fallback fails, error should be actionable
    expect(response.content).not.toBe('No agents available to handle this request.');
    expect(response.content.length).toBeGreaterThan(10);
  });

  test('directResponse: true without AI backend falls through (no backendProcess to call)', async () => {
    // If a custom router returns directResponse: true but there's no backendProcess,
    // the conductor can't generate an AI response. Should fall through gracefully.
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Wants direct response but no backend',
    }));

    const response = await conductor.handleMessage(makeMessage());

    // Without a backendProcess, directResponse: true can't be fulfilled.
    // Should still provide something actionable, not crash.
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
  });

  test('agentIds AND directResponse both present: agentIds take precedence for delegation', async () => {
    const { backend } = createSimpleBackend('This should not be used');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    await pool.create(makeAgent({ id: 'existing-agent', name: 'Existing Agent' }));
    pool.setSendResponse('Agent response wins');

    conductor.setRouter(async () => ({
      agentIds: ['existing-agent'],
      directResponse: true,
      reason: 'Agent available, delegate to it',
    }));

    const response = await conductor.handleMessage(makeMessage());

    // When agentIds has valid entries, delegation should happen
    // directResponse is only used when there are no agents to delegate to
    expect(response.content).toBe('Agent response wins');
    expect(response.agentId).toBe('existing-agent');
  });

  test('createAgent AND directResponse both present: createAgent takes precedence', async () => {
    const { backend } = createSimpleBackend('This should not be used either');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();
    pool.setSendResponse('New agent result');

    conductor.setRouter(async () => ({
      agentIds: [],
      createAgent: { name: 'Worker', role: 'worker', systemPrompt: 'Work.' },
      directResponse: true,
      reason: 'Creating agent takes priority',
    }));

    const response = await conductor.handleMessage(makeMessage());

    // createAgent should take precedence over directResponse
    expect(response.content).toBe('New agent result');
    expect(pool.create).toHaveBeenCalled();
  });

  test('debug events are complete when conductor responds directly', async () => {
    const { backend } = createSimpleBackend('Direct debug test response.');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Debug test',
    }));

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    // Should still have the full event lifecycle
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain(ConductorEventType.MEMORY_SEARCH);
    expect(eventTypes).toContain(ConductorEventType.ROUTING);
    expect(eventTypes).toContain(ConductorEventType.ROUTING_COMPLETE);
    expect(eventTypes).toContain(ConductorEventType.DELEGATION_COMPLETE);
    expect(eventTypes).toContain(ConductorEventType.MEMORY_STORE);

    // And the new RESPONDING event
    expect(eventTypes).toContain(ConductorEventType.RESPONDING);
  });

  test('conductor direct response still stores conversation in memory', async () => {
    const { backend } = createSimpleBackend('Stored response.');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Test memory storage',
    }));

    await conductor.handleMessage(makeMessage({ content: 'Remember this' }));

    // Memory store should still be called
    expect(memory.storeCalls.length).toBe(1);
    expect(memory.storeCalls[0].content).toBe('Remember this');
  });

  test('conductor direct response sets agentId to undefined in ConductorResponse', async () => {
    const { backend } = createSimpleBackend('I handled this myself.');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'No agent involved',
    }));

    const response = await conductor.handleMessage(makeMessage());

    // agentId should be undefined since no agent was involved
    expect(response.agentId).toBeUndefined();
    expect(response.content).toBe('I handled this myself.');
  });
});

describe('Conductor direct response — ConductorDecision action type', () => {
  test('ConductorDecision supports "direct_response" action', async () => {
    const { backend } = createSimpleBackend('Testing decision action.');
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      backend,
    );
    await conductor.initialize();

    conductor.setRouter(async () => ({
      agentIds: [],
      directResponse: true,
      reason: 'Direct response test',
    }));

    const response = await conductor.handleMessage(makeMessage());

    // The decisions array should include a "direct_response" action
    const actions = response.decisions.map((d) => d.action);
    expect(actions).toContain('direct_response');
  });
});

describe('Conductor direct response — system prompt update', () => {
  test('CONDUCTOR_SYSTEM_PROMPT mentions direct response option', async () => {
    // The AI system prompt should instruct the AI that it CAN respond directly
    // without creating an agent or routing to one
    const { CONDUCTOR_SYSTEM_PROMPT } = await import('../src/conductor-prompt.ts');

    // The system prompt should mention the directResponse option
    expect(CONDUCTOR_SYSTEM_PROMPT).toContain('directResponse');
  });
});
