/**
 * Session Lifecycle — Tests for agent-manager session support.
 *
 * They validate that:
 *  - BackendSpawnConfig accepts sessionId and sessionPersistence fields
 *  - AgentProcess passes session fields through to backend.spawn()
 *  - AgentProcess.toRuntimeInfo() includes session fields
 *  - Ephemeral agents don't get session flags
 *  - Persistent agents get session flags
 *  - Session ID survives restart
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { type AgentDefinition, AgentOwner } from '@autonomy/shared';
import { AgentProcess } from '../src/agent-process.ts';
import { MockBackend } from './helpers/mock-backend.ts';

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'session-test-agent',
    name: 'Session Test Agent',
    role: 'tester',
    tools: [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: AgentOwner.USER,
    persistent: false,
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}

describe('V2 Phase 1 — Session lifecycle in agent-manager', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = new MockBackend();
    backend.setResponses(['session test response']);
  });

  describe('BackendSpawnConfig session fields', () => {
    test('sessionId is passed to backend.spawn()', async () => {
      const def = makeAgent({
        id: 'persistent-agent',
        persistent: true,
      });

      // After V2 Phase 1, a persistent agent should have a sessionId
      // and it should be passed through to backend.spawn()
      const agent = new AgentProcess(def, backend);
      await agent.start();

      const spawnConfig = backend.spawnCalls[0];
      expect(spawnConfig).toBeDefined();

      // This should fail — current BackendSpawnConfig has no sessionId field
      expect((spawnConfig as Record<string, unknown>).sessionId).toBeDefined();
    });

    test('ephemeral agent does NOT get sessionId in spawn config', async () => {
      const def = makeAgent({
        id: 'ephemeral-agent',
        persistent: false,
      });

      const agent = new AgentProcess(def, backend);
      await agent.start();

      const spawnConfig = backend.spawnCalls[0];
      // Ephemeral agents should not have session persistence
      expect((spawnConfig as Record<string, unknown>).sessionId).toBeUndefined();
    });

    test('sessionPersistence flag is passed to backend.spawn()', async () => {
      const def = makeAgent({
        id: 'persistent-agent',
        persistent: true,
      });

      const agent = new AgentProcess(def, backend);
      await agent.start();

      const spawnConfig = backend.spawnCalls[0];
      // Persistent agents should have sessionPersistence: true in spawn config
      expect((spawnConfig as Record<string, unknown>).sessionPersistence).toBe(true);
    });
  });

  describe('AgentProcess session state', () => {
    test('toRuntimeInfo() includes sessionId for persistent agent', async () => {
      const def = makeAgent({
        id: 'info-agent',
        persistent: true,
      });

      const agent = new AgentProcess(def, backend);
      await agent.start();

      const info = agent.toRuntimeInfo();
      // After V2, runtime info should expose sessionId
      expect((info as Record<string, unknown>).sessionId).toBeDefined();
    });

    test('session ID survives restart for persistent agent', async () => {
      const def = makeAgent({
        id: 'restart-session-agent',
        persistent: true,
      });

      const agent = new AgentProcess(def, backend);
      await agent.start();

      // Capture session ID from first spawn
      const firstSpawnConfig = backend.spawnCalls[0];
      const firstSessionId = (firstSpawnConfig as Record<string, unknown>).sessionId;

      await agent.restart();

      // After restart, second spawn should use the SAME session ID
      const secondSpawnConfig = backend.spawnCalls[1];
      const secondSessionId = (secondSpawnConfig as Record<string, unknown>).sessionId;

      expect(firstSessionId).toBeDefined();
      expect(secondSessionId).toBe(firstSessionId);
    });
  });
});
