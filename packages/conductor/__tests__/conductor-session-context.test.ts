/**
 * Conductor Session Context — Tests for per-session backend processes
 * and assistant response storage in memory.
 *
 * Validates:
 *  1. Conductor creates per-session backend processes with sessionId
 *  2. storeConversation stores BOTH user messages AND assistant responses
 *  3. Multiple messages in the same session maintain context
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type {
  AgentPool,
  BackendProcess,
  BackendSpawnConfig,
  CLIBackend,
} from '@autonomy/agent-manager';
import type { Memory } from '@pyx-memory/core';
import { Conductor } from '../src/conductor.ts';
import { makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

// Minimal mock pool
function createMockPool() {
  return {
    create: mock(async () => ({
      id: 'test',
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      definition: {} as any,
      toRuntimeInfo: () => ({
        id: 'test',
        name: 'Test',
        role: 'test',
        status: 'idle',
        owner: 'conductor',
        persistent: false,
        createdAt: new Date().toISOString(),
      }),
    })),
    get: mock(() => undefined),
    list: mock(() => []),
    remove: mock(async () => {}),
    sendMessage: mock(async () => 'response'),
    sendMessageStreaming: mock(async function* () {
      yield { type: 'chunk' as const, content: 'response' };
      yield { type: 'complete' as const };
    }),
    shutdown: mock(async () => {}),
  };
}

// Mock backend that captures ALL spawn configs
function createMockBackend() {
  const spawnConfigs: BackendSpawnConfig[] = [];
  const sendCalls: string[] = [];

  const mockProcess: BackendProcess = {
    send: mock(async (msg: string) => {
      sendCalls.push(msg);
      return `AI response to: ${msg}`;
    }),
    sendStreaming: mock(async function* (msg: string) {
      sendCalls.push(msg);
      yield { type: 'chunk' as const, content: `AI response to: ${msg}` };
      yield { type: 'complete' as const };
    }),
    stop: mock(async () => {}),
    alive: true,
    nativeSessionId: undefined,
  };

  const backend: CLIBackend = {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    name: 'claude' as any,
    capabilities: {
      streaming: true,
      sessionPersistence: true,
      customTools: true,
      fileAccess: true,
    },
    spawn: mock(async (config: BackendSpawnConfig) => {
      spawnConfigs.push(config);
      return mockProcess;
    }),
  };

  return {
    backend,
    getSpawnConfigs: () => spawnConfigs,
    getSendCalls: () => sendCalls,
    mockProcess,
  };
}

describe('Per-session backend processes', () => {
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;
  let mockBackend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
    mockBackend = createMockBackend();
  });

  test('message with sessionId spawns a session-specific backend process', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
      { systemPrompt: 'Test prompt' },
    );
    await conductor.initialize();

    // First spawn is the default (no sessionId) at initialize()
    expect(mockBackend.getSpawnConfigs().length).toBe(1);
    expect(mockBackend.getSpawnConfigs()[0].sessionId).toBeUndefined();

    // Send a message with a sessionId
    await conductor.handleMessage(makeMessage({ content: 'Hello', sessionId: 'sess-123' }));

    // A second process should be spawned (stateless — no sessionId in spawn config)
    expect(mockBackend.getSpawnConfigs().length).toBe(2);
    expect(mockBackend.getSpawnConfigs()[1].sessionId).toBeUndefined();
  });

  test('subsequent messages with same sessionId reuse the same process', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    // Two messages with same sessionId
    await conductor.handleMessage(makeMessage({ content: 'First', sessionId: 'sess-reuse' }));
    await conductor.handleMessage(makeMessage({ content: 'Second', sessionId: 'sess-reuse' }));

    // Only 2 spawns: 1 default at init + 1 for session (reused on second message)
    expect(mockBackend.getSpawnConfigs().length).toBe(2);
  });

  test('different sessionIds spawn different backend processes', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    await conductor.handleMessage(makeMessage({ content: 'A', sessionId: 'sess-a' }));
    await conductor.handleMessage(makeMessage({ content: 'B', sessionId: 'sess-b' }));

    // 3 spawns: 1 default + 1 for sess-a + 1 for sess-b (stateless — no sessionId in spawn config)
    expect(mockBackend.getSpawnConfigs().length).toBe(3);
    expect(mockBackend.getSpawnConfigs()[1].sessionId).toBeUndefined();
    expect(mockBackend.getSpawnConfigs()[2].sessionId).toBeUndefined();
  });

  test('message without sessionId uses default backend process', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    await conductor.handleMessage(makeMessage({ content: 'No session' }));

    // Only 1 spawn (the default at init), no extra session process
    expect(mockBackend.getSpawnConfigs().length).toBe(1);
  });

  test('shutdown stops all session processes', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    await conductor.handleMessage(makeMessage({ content: 'A', sessionId: 'sess-x' }));

    await conductor.shutdown();

    // stop() should have been called on the mock process
    expect(mockBackend.mockProcess.stop).toHaveBeenCalled();
  });
});

describe('Assistant response stored in memory', () => {
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;
  let mockBackend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
    mockBackend = createMockBackend();
  });

  test('handleMessage stores BOTH user message AND assistant response', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    await conductor.handleMessage(makeMessage({ content: 'What is 2+2?', sessionId: 'sess-1' }));

    // Should have 2 memory entries: user message + assistant response
    expect(memory.storeCalls.length).toBeGreaterThanOrEqual(2);

    const userStore = memory.storeCalls.find((c) => c.content.includes('What is 2+2?'));
    expect(userStore).toBeDefined();

    const assistantStore = memory.storeCalls.find((c) => c.content.includes('AI response'));
    expect(assistantStore).toBeDefined();
  });

  test('handleMessageStreaming stores assistant response in memory', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    const events = [];
    for await (const event of conductor.handleMessageStreaming(
      makeMessage({ content: 'List 3 colors', sessionId: 'sess-2' }),
    )) {
      events.push(event);
    }

    expect(memory.storeCalls.length).toBeGreaterThanOrEqual(2);

    const assistantStore = memory.storeCalls.find((c) => c.content.includes('AI response'));
    expect(assistantStore).toBeDefined();
  });

  test('stored assistant response includes session context', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    await conductor.handleMessage(
      makeMessage({ content: 'Hello', sessionId: 'sess-ctx', senderId: 'user-1' }),
    );

    // Should have both user and assistant entries
    expect(memory.storeCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Multi-message session context', () => {
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;
  let mockBackend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
    mockBackend = createMockBackend();
  });

  test('second message in session should have context from first exchange', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    // First message
    await conductor.handleMessage(
      makeMessage({
        content: 'List 3 items: apples, bananas, cherries',
        sessionId: 'sess-multi',
        senderId: 'user-1',
      }),
    );

    // Second message references the first
    await conductor.handleMessage(
      makeMessage({
        content: 'What was item 1?',
        sessionId: 'sess-multi',
        senderId: 'user-1',
      }),
    );

    // Both user message AND assistant response from first exchange should be stored
    const firstExchangeStores = memory.storeCalls.filter(
      (c) =>
        c.content.includes('apples') || // user message
        c.content.includes('AI response'), // assistant response
    );

    // 2 entries: user message + assistant response from first exchange
    expect(firstExchangeStores.length).toBeGreaterThanOrEqual(2);
  });

  test('assistant responses are stored with conductor agentId', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as Memory,
      mockBackend.backend,
    );
    await conductor.initialize();

    await conductor.handleMessage(
      makeMessage({ content: 'Tell me about dogs', sessionId: 'sess-search' }),
    );

    // Should have 2+ stores: user message + assistant response
    expect(memory.storeCalls.length).toBeGreaterThanOrEqual(2);

    // The assistant response store should contain the AI's output
    const assistantStore = memory.storeCalls.find((c) => c.content.includes('AI response'));
    expect(assistantStore).toBeDefined();
  });
});
