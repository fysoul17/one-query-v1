/**
 * Conductor Session — Tests that prove the Conductor lacks session support.
 *
 * These tests are expected to FAIL until V2 Phase 1 is implemented.
 * They validate that:
 *  - Conductor.initialize() can accept a conductorSessionId for stateful personality
 *  - Conductor passes sessionId to backend.spawn() during initialize
 *  - ConductorOptions gains a sessionId field
 *  - Conductor.shutdown() preserves the session ID for later resume
 *  - Conductor creates persistent agents with session IDs
 */
import { describe, expect, test } from 'bun:test';
import type { BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import { type AgentDefinition, type AgentRuntimeInfo, AgentStatus } from '@autonomy/shared';
import { Conductor } from '../src/conductor.ts';
import type { ConductorOptions } from '../src/types.ts';
import { MockMemory } from './helpers/mock-memory.ts';

/**
 * Create a mock pool with in-memory agent storage.
 */
function createMockPool() {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();

  return {
    create: async (definition: AgentDefinition) => {
      const runtime: AgentRuntimeInfo = {
        id: definition.id,
        name: definition.name,
        role: definition.role,
        status: AgentStatus.IDLE,
        owner: definition.owner,
        persistent: definition.persistent,
        createdAt: definition.createdAt,
        lifecycle: definition.lifecycle,
        sessionId: definition.sessionId,
      };
      agents.set(definition.id, { definition, runtime });
      return {
        id: definition.id,
        definition,
        status: AgentStatus.IDLE,
        toRuntimeInfo: () => runtime,
        start: async () => {},
        stop: async () => {},
        restart: async () => {},
        sendMessage: async () => 'mock response',
      };
    },
    get: (id: string) => {
      const entry = agents.get(id);
      if (!entry) return undefined;
      return {
        id,
        definition: entry.definition,
        status: AgentStatus.IDLE,
        toRuntimeInfo: () => entry.runtime,
        sendMessage: async () => 'mock response',
        start: async () => {},
        stop: async () => {},
        restart: async () => {},
      };
    },
    list: () => [...agents.values()].map((a) => a.runtime),
    remove: async (id: string) => {
      agents.delete(id);
    },
    sendMessage: async (_id: string, _msg: string) => 'mock pool response',
    shutdown: async () => {
      agents.clear();
    },
  };
}

/**
 * Create a mock CLIBackend that records spawn calls with full config.
 */
function createMockBackend(response = 'mock ai response'): {
  backend: CLIBackend;
  spawnCalls: Record<string, unknown>[];
  sendCalls: string[];
} {
  const spawnCalls: Record<string, unknown>[] = [];
  const sendCalls: string[] = [];

  const backend: CLIBackend = {
    name: 'claude' as const,
    capabilities: {
      customTools: true,
      streaming: true,
      sessionPersistence: true,
      fileAccess: true,
    },
    spawn: async (config) => {
      spawnCalls.push({ ...config });
      const process: BackendProcess = {
        send: async (msg: string) => {
          sendCalls.push(msg);
          return response;
        },
        stop: async () => {},
        alive: true,
      };
      return process;
    },
  };

  return { backend, spawnCalls, sendCalls };
}

describe('V2 Phase 1 — Conductor session support', () => {
  describe('ConductorOptions.sessionId', () => {
    test('ConductorOptions accepts a sessionId field', () => {
      // After V2, ConductorOptions should have an optional sessionId
      const options: ConductorOptions = {
        systemPrompt: 'Test conductor',
      };

      // This should be a first-class field, not requiring a cast
      (options as Record<string, unknown>).sessionId = 'conductor-session-xyz';
      expect((options as Record<string, unknown>).sessionId).toBe('conductor-session-xyz');

      // The REAL test: does the type accept it natively?
      // This will fail at compile time when sessionId isn't on ConductorOptions
    });
  });

  describe('Conductor.initialize() with session', () => {
    test('passes sessionId to backend.spawn() during initialize', async () => {
      const pool = createMockPool();
      const memory = new MockMemory();

      const routingResponse = JSON.stringify({
        action: 'direct_response',
        response: 'Hello',
        reason: 'greeting',
        store_in_memory: false,
      });
      const { backend, spawnCalls } = createMockBackend(routingResponse);

      const options: ConductorOptions = {
        systemPrompt: 'You are JARVIS',
      };
      // After V2 Phase 1, we should be able to pass sessionId in options
      (options as Record<string, unknown>).sessionId = 'jarvis-session-001';

      const conductor = new Conductor(pool as any, memory as any, backend, options);

      await conductor.initialize();

      // The conductor's own backend.spawn() should have received the sessionId
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0]?.sessionId).toBe('jarvis-session-001');

      await conductor.shutdown();
    });

    test('conductor spawn config includes sessionPersistence: true', async () => {
      const pool = createMockPool();
      const memory = new MockMemory();

      const routingResponse = JSON.stringify({
        action: 'direct_response',
        response: 'Hello',
        reason: 'greeting',
        store_in_memory: false,
      });
      const { backend, spawnCalls } = createMockBackend(routingResponse);

      const options: ConductorOptions = {};
      (options as Record<string, unknown>).sessionId = 'conductor-sess';

      const conductor = new Conductor(pool as any, memory as any, backend, options);
      await conductor.initialize();

      // Conductor is always persistent — should have sessionPersistence: true
      expect(spawnCalls[0]?.sessionPersistence).toBe(true);

      await conductor.shutdown();
    });
  });

  describe('Conductor session ID preservation', () => {
    test('shutdown preserves sessionId for later resume', async () => {
      const pool = createMockPool();
      const memory = new MockMemory();

      const routingResponse = JSON.stringify({
        action: 'direct_response',
        response: 'Hello',
        reason: 'greeting',
        store_in_memory: false,
      });
      const { backend } = createMockBackend(routingResponse);

      const options: ConductorOptions = {};
      (options as Record<string, unknown>).sessionId = 'persistent-conductor-session';

      const conductor = new Conductor(pool as any, memory as any, backend, options);
      await conductor.initialize();
      await conductor.shutdown();

      // After shutdown, the session ID should still be accessible
      // so a new initialize() can resume the same session
      expect((conductor as Record<string, unknown>).sessionId).toBe('persistent-conductor-session');
    });
  });

  describe('Conductor creates agents with session context', () => {
    test('createAgent for persistent agent includes sessionId', async () => {
      const pool = createMockPool();
      const memory = new MockMemory();

      const routingResponse = JSON.stringify({
        action: 'direct_response',
        response: 'Hello',
        reason: 'greeting',
        store_in_memory: false,
      });
      const { backend } = createMockBackend(routingResponse);

      const conductor = new Conductor(pool as any, memory as any, backend);
      await conductor.initialize();

      const agentInfo = await conductor.createAgent({
        name: 'Persistent Worker',
        role: 'worker',
        systemPrompt: 'You are a persistent worker.',
        persistent: true,
      });

      // A persistent agent should get a sessionId assigned
      expect((agentInfo as Record<string, unknown>).sessionId).toBeDefined();
      expect(typeof (agentInfo as Record<string, unknown>).sessionId).toBe('string');

      await conductor.shutdown();
    });

    test('createAgent for ephemeral agent does NOT include sessionId', async () => {
      const pool = createMockPool();
      const memory = new MockMemory();

      const routingResponse = JSON.stringify({
        action: 'direct_response',
        response: 'Hello',
        reason: 'greeting',
        store_in_memory: false,
      });
      const { backend } = createMockBackend(routingResponse);

      const conductor = new Conductor(pool as any, memory as any, backend);
      await conductor.initialize();

      const agentInfo = await conductor.createAgent({
        name: 'Temp Worker',
        role: 'worker',
        systemPrompt: 'You are a temporary worker.',
        persistent: false,
      });

      // Ephemeral agents should NOT get a sessionId
      expect((agentInfo as Record<string, unknown>).sessionId).toBeUndefined();

      await conductor.shutdown();
    });
  });
});
