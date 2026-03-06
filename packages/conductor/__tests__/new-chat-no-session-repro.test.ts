/**
 * Reproduction tests: New chats use ephemeral WS UUID as session — context lost on reconnect
 *
 * Current state (partially fixed):
 *  - handleConductorMessage uses `ws.data.sessionId ?? ws.data.id` as effectiveSessionId
 *  - So the conductor DOES get a sessionId (the WS connection UUID)
 *  - This provides conversation continuity WITHIN a single WS connection
 *  - BUT: messages are NOT persisted to the session store
 *  - AND: on reconnect, a new UUID is generated, losing all context
 *
 * Remaining bugs proven by these tests:
 *  1. Ephemeral session IDs mean WS reconnect = total context loss
 *  2. Messages are not persisted (session store requires ws.data.sessionId, not effectiveSessionId)
 *  3. No session_init sent to client, so client can't maintain session across reconnects
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type {
  AgentPool,
  BackendProcess,
  BackendSpawnConfig,
  CLIBackend,
} from '@autonomy/agent-manager';
import type { MemoryInterface } from '@autonomy/shared';
import { AIBackend } from '@autonomy/shared';
import { Conductor } from '../src/conductor.ts';
import { makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

// Tracks ALL spawn calls and their configs
function createTrackingBackend() {
  const spawnConfigs: BackendSpawnConfig[] = [];
  const sendHistory: Array<{ processIndex: number; message: string }> = [];
  const processes: BackendProcess[] = [];

  const backend: CLIBackend = {
    name: AIBackend.CLAUDE,
    capabilities: {
      streaming: true,
      sessionPersistence: true,
      customTools: true,
      fileAccess: true,
    },
    spawn: mock(async (config: BackendSpawnConfig) => {
      spawnConfigs.push(config);
      const processIndex = processes.length;
      const proc: BackendProcess = {
        send: mock(async (msg: string) => {
          sendHistory.push({ processIndex, message: msg });
          return `Response from process-${processIndex}`;
        }),
        sendStreaming: mock(async function* (msg: string) {
          sendHistory.push({ processIndex, message: msg });
          yield { type: 'chunk' as const, content: `Response from process-${processIndex}` };
          yield { type: 'complete' as const };
        }),
        stop: mock(async () => {}),
        alive: true,
        nativeSessionId: undefined,
      };
      processes.push(proc);
      return proc;
    }),
  };

  return {
    backend,
    getSpawnConfigs: () => spawnConfigs,
    getSendHistory: () => sendHistory,
    getProcesses: () => processes,
  };
}

function createMockPool() {
  return {
    create: mock(async () => ({
      id: 'test',
      definition: {} as unknown as import('@autonomy/shared').AgentDefinition,
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

describe('New chat with ephemeral WS UUID as sessionId', () => {
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;
  let tracking: ReturnType<typeof createTrackingBackend>;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
    tracking = createTrackingBackend();
  });

  test('ephemeral WS UUID creates per-session backend process', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
      { systemPrompt: 'Test prompt' },
    );
    await conductor.initialize();

    // Simulate: WS handler passes ws.data.id as sessionId for new chats
    await conductor.handleMessage(makeMessage({ content: 'Hello', sessionId: 'ws-conn-uuid-abc' }));

    // 3 spawns: default (at init) + session-specific + extraction process
    const configs = tracking.getSpawnConfigs();
    expect(configs.length).toBe(3);
    expect(configs[0].sessionId).toBeUndefined(); // default process
    // Conductor spawns stateless processes — sessionId is tracked internally,
    // not passed in the spawn config (CLI session flags are a V2 feature)
    expect(configs[1].sessionId).toBeUndefined();
  });

  test('multiple messages with same ephemeral UUID reuse same process', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    // All messages in a single WS connection get the same UUID
    await conductor.handleMessage(
      makeMessage({ content: 'My name is Alice', sessionId: 'ws-conn-1' }),
    );
    await conductor.handleMessage(
      makeMessage({ content: 'What is my name?', sessionId: 'ws-conn-1' }),
    );

    // 3 spawns: default + 1 session process (reused) + extraction process
    expect(tracking.getSpawnConfigs().length).toBe(3);

    // Both user messages go to the session process (index 1); extraction sends interleaved
    const history = tracking.getSendHistory();
    const sessionSends = history.filter((h) => !h.message.startsWith('Extract named entities'));
    expect(sessionSends[0].processIndex).toBe(1);
    expect(sessionSends[1].processIndex).toBe(1);
  });

  test('WS reconnect creates new session process, losing context', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    // First WS connection
    await conductor.handleMessage(
      makeMessage({ content: 'My name is Alice', sessionId: 'ws-conn-1' }),
    );

    // WS reconnects — new UUID generated
    await conductor.handleMessage(
      makeMessage({ content: 'What is my name?', sessionId: 'ws-conn-2' }),
    );

    // 4 spawns: default + ws-conn-1 + ws-conn-2 + extraction process
    const configs = tracking.getSpawnConfigs();
    expect(configs.length).toBe(4);
    // Conductor spawns stateless processes — sessionId tracked internally, not in config
    expect(configs[1].sessionId).toBeUndefined();
    expect(configs[2].sessionId).toBeUndefined();

    // Messages go to different processes — context is LOST
    const history = tracking.getSendHistory();
    const sessionSends = history.filter((h) => !h.message.startsWith('Extract named entities'));
    expect(sessionSends[0].processIndex).toBe(1); // ws-conn-1 process
    expect(sessionSends[1].processIndex).toBe(3); // ws-conn-2 process (no context from conn-1)

    // Known limitation: The second message is sent to a brand new Claude CLI session
    // that has no knowledge of the first message. Memory-based context retrieval
    // provides partial continuity.
  });

  test('streaming: ephemeral UUID creates per-session process', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    const events = [];
    for await (const event of conductor.handleMessageStreaming(
      makeMessage({ content: 'Hello streaming', sessionId: 'ws-stream-uuid' }),
    )) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'chunk')).toBe(true);

    // Session-specific + extraction process were created
    const configs = tracking.getSpawnConfigs();
    expect(configs.length).toBe(3);
    // Conductor spawns stateless processes — sessionId tracked internally, not in config
    expect(configs[1].sessionId).toBeUndefined();
  });
});

describe('Contrast: proper session vs ephemeral session behavior', () => {
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;
  let tracking: ReturnType<typeof createTrackingBackend>;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
    tracking = createTrackingBackend();
  });

  test('real sessionId survives reconnect (same sessionId used)', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    // Real session: same ID used across reconnections
    await conductor.handleMessage(
      makeMessage({ content: 'First message', sessionId: 'real-session-abc' }),
    );
    await conductor.handleMessage(
      makeMessage({ content: 'After reconnect', sessionId: 'real-session-abc' }),
    );

    // 3 spawns: default + 1 session process (reused) + extraction process
    expect(tracking.getSpawnConfigs().length).toBe(3);

    // Both user messages go to the same session process — context is preserved
    const history = tracking.getSendHistory();
    const sessionSends = history.filter((h) => !h.message.startsWith('Extract named entities'));
    expect(sessionSends[0].processIndex).toBe(1);
    expect(sessionSends[1].processIndex).toBe(1);
  });

  test('messages without sessionId at all use default process', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    // No sessionId at all (not even ephemeral UUID)
    await conductor.handleMessage(makeMessage({ content: 'No session' }));

    // 2 spawns: default + extraction process
    expect(tracking.getSpawnConfigs().length).toBe(2);
    expect(tracking.getSpawnConfigs()[0].sessionId).toBeUndefined();
  });
});

describe('Edge cases: session process lifecycle', () => {
  let pool: ReturnType<typeof createMockPool>;
  let memory: MockMemory;
  let tracking: ReturnType<typeof createTrackingBackend>;

  beforeEach(() => {
    pool = createMockPool();
    memory = new MockMemory();
    tracking = createTrackingBackend();
  });

  test('empty string sessionId uses default process (no session)', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    // Edge case: empty string sessionId
    await conductor.handleMessage(makeMessage({ content: 'Hello', sessionId: '' }));

    // Empty string is falsy, getBackendProcess('') returns default; +1 for extraction
    expect(tracking.getSpawnConfigs().length).toBe(2);
    expect(tracking.getSpawnConfigs()[0].sessionId).toBeUndefined();
  });

  test('mixed: some messages have real sessions, some have ephemeral UUIDs', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    // New chat: ephemeral UUID
    await conductor.handleMessage(makeMessage({ content: 'First', sessionId: 'ws-ephemeral-1' }));

    // Resumed session: real session ID
    await conductor.handleMessage(
      makeMessage({ content: 'Second', sessionId: 'real-session-xyz' }),
    );

    // Another new chat: different ephemeral UUID
    await conductor.handleMessage(makeMessage({ content: 'Third', sessionId: 'ws-ephemeral-2' }));

    const history = tracking.getSendHistory();
    const sessionSends = history.filter((h) => !h.message.startsWith('Extract named entities'));
    expect(sessionSends.length).toBe(3);

    // Each gets its own session process; extraction process (index 2) is interleaved
    expect(sessionSends[0].processIndex).toBe(1); // ws-ephemeral-1
    expect(sessionSends[1].processIndex).toBe(3); // real-session-xyz
    expect(sessionSends[2].processIndex).toBe(4); // ws-ephemeral-2

    // Total: 5 spawns (default + 3 session processes + 1 extraction process)
    expect(tracking.getSpawnConfigs().length).toBe(5);
  });

  test('shutdown stops ephemeral session processes too', async () => {
    const conductor = new Conductor(
      pool as unknown as AgentPool,
      memory as unknown as MemoryInterface,
      tracking.backend,
    );
    await conductor.initialize();

    await conductor.handleMessage(makeMessage({ content: 'A', sessionId: 'ws-ephemeral' }));

    await conductor.shutdown();

    // stop() should have been called on all processes
    for (const proc of tracking.getProcesses()) {
      expect(proc.stop).toHaveBeenCalled();
    }
  });
});
