import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AgentPool, BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import { type AgentDefinition, type AgentRuntimeInfo, AgentStatus } from '@autonomy/shared';
import type { Memory } from '@pyx-memory/core';
import { Conductor } from '../src/conductor.ts';
import { makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

function createMockPool() {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();
  return {
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
      return { id: definition.id, definition, toRuntimeInfo: () => runtime };
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
    sendMessage: mock(async () => 'Mock response'),
    shutdown: mock(async () => {
      agents.clear();
    }),
  };
}

function createMockBackend(name: string, shouldFail = false): CLIBackend {
  const sendFn = mock(async (_prompt: string) => `Response from ${name}`);
  return {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    name: name as any,
    capabilities: {
      customTools: false,
      streaming: false,
      sessionPersistence: false,
      fileAccess: false,
    },
    spawn: mock(async () => {
      if (shouldFail) throw new Error(`${name} spawn failed`);
      return {
        send: sendFn,
        stop: mock(async () => {}),
        alive: true,
      } as unknown as BackendProcess;
    }),
    getConfigOptions: () => [],
  };
}

describe('Conductor fallback backend', () => {
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
  });

  test('primary works → fallback not touched', async () => {
    const primary = createMockBackend('claude');
    const fallback = createMockBackend('ollama');
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      primary,
      {
        fallbackBackend: fallback,
      },
    );
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage({ sessionId: 'sess-1' }));
    expect(response.content).toContain('Response from claude');
    expect(fallback.spawn).not.toHaveBeenCalled();
  });

  test('primary spawn fails → fallback used → response returned', async () => {
    const primary = createMockBackend('claude', true);
    const fallback = createMockBackend('ollama');
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      primary,
      {
        fallbackBackend: fallback,
      },
    );
    await conductor.initialize();

    // Initialize uses fallback since primary fails
    expect(fallback.spawn).toHaveBeenCalledTimes(1);

    // Session-based message should also use fallback
    const response = await conductor.handleMessage(makeMessage({ sessionId: 'sess-1' }));
    expect(response.content).toContain('Response from ollama');
  });

  test('primary spawn fails → no fallback → returns FALLBACK_NO_BACKEND', async () => {
    const primary = createMockBackend('claude', true);
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      primary,
    );
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage({ sessionId: 'sess-1' }));
    expect(response.content).toContain('no AI backend configured');
  });

  test('primary and fallback both fail → returns FALLBACK_NO_BACKEND', async () => {
    const primary = createMockBackend('claude', true);
    const fallback = createMockBackend('ollama', true);
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      primary,
      {
        fallbackBackend: fallback,
      },
    );
    await conductor.initialize();

    const response = await conductor.handleMessage(makeMessage({ sessionId: 'sess-1' }));
    expect(response.content).toContain('no AI backend configured');
  });
});
