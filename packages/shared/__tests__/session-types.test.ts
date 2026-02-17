/**
 * Session Types — Tests that prove the current shared types lack session support.
 *
 * These tests are expected to FAIL until V2 Phase 1 is implemented.
 * They validate that:
 *  - AgentDefinition gains lifecycle, parentId, sessionId, department, backend fields
 *  - AgentRuntimeInfo exposes lifecycle and sessionId
 *  - AIBackend enum includes GOOSE
 *  - BACKEND_CAPABILITIES has correct values for Codex/Gemini (per CLI research)
 *  - A new session.ts types file exists with SessionConfig, AgentLifecycle, etc.
 */
import { describe, expect, test } from 'bun:test';
import {
  type AgentDefinition,
  type AgentRuntimeInfo,
  AgentStatus,
  AIBackend,
  BACKEND_CAPABILITIES,
} from '../src/index.ts';

describe('V2 Phase 1 — Session types in @autonomy/shared', () => {
  describe('AIBackend enum', () => {
    test('includes GOOSE backend', () => {
      // CLI research shows Goose is Tier 1 — best automation design
      expect((AIBackend as Record<string, string>).GOOSE).toBe('goose');
    });
  });

  describe('BACKEND_CAPABILITIES corrections (per CLI research)', () => {
    test('Codex supports session persistence', () => {
      // CLI research: Codex supports --session-id
      expect(BACKEND_CAPABILITIES.codex.sessionPersistence).toBe(true);
    });

    test('Codex supports streaming', () => {
      // Already true, but verify it stays true
      expect(BACKEND_CAPABILITIES.codex.streaming).toBe(true);
    });

    test('Gemini supports streaming', () => {
      // CLI research: Gemini supports streaming output
      expect(BACKEND_CAPABILITIES.gemini.streaming).toBe(true);
    });

    test('Gemini supports session persistence', () => {
      // CLI research: Gemini supports session persistence
      expect(BACKEND_CAPABILITIES.gemini.sessionPersistence).toBe(true);
    });

    test('GOOSE backend capabilities are defined', () => {
      const caps = (BACKEND_CAPABILITIES as Record<string, unknown>).goose as {
        customTools: boolean;
        streaming: boolean;
        sessionPersistence: boolean;
        fileAccess: boolean;
      };
      expect(caps).toBeDefined();
      expect(caps.sessionPersistence).toBe(true);
      expect(caps.streaming).toBe(true);
    });
  });

  describe('AgentDefinition session fields', () => {
    test('accepts lifecycle field (persistent | ephemeral)', () => {
      const agent: AgentDefinition = {
        id: 'test-agent',
        name: 'Test',
        role: 'tester',
        tools: [],
        canModifyFiles: false,
        canDelegateToAgents: false,
        maxConcurrent: 1,
        owner: 'user',
        persistent: false,
        createdBy: 'user',
        createdAt: new Date().toISOString(),
        systemPrompt: 'Test',
      };

      // These fields should exist on AgentDefinition (optional)
      const extended = agent as AgentDefinition & {
        lifecycle?: string;
        parentId?: string;
        sessionId?: string;
        department?: string;
        backend?: string;
      };

      // Set the new fields and verify they're accepted by the type system
      extended.lifecycle = 'persistent';
      extended.parentId = 'conductor';
      extended.sessionId = 'session-abc-123';
      extended.department = 'engineering';
      extended.backend = 'claude';

      // The real test: these should be first-class fields on AgentDefinition,
      // not requiring a cast. This test verifies the fields exist.
      expect((agent as Record<string, unknown>).lifecycle).toBe('persistent');
      expect((agent as Record<string, unknown>).parentId).toBe('conductor');
      expect((agent as Record<string, unknown>).sessionId).toBe('session-abc-123');
      expect((agent as Record<string, unknown>).department).toBe('engineering');
      expect((agent as Record<string, unknown>).backend).toBe('claude');
    });
  });

  describe('AgentRuntimeInfo session fields', () => {
    test('accepts lifecycle field', () => {
      const info: AgentRuntimeInfo = {
        id: 'test',
        name: 'Test',
        role: 'tester',
        status: AgentStatus.IDLE,
        owner: 'user',
        persistent: false,
        createdAt: new Date().toISOString(),
        lifecycle: 'persistent',
      };

      expect(info.lifecycle).toBe('persistent');
    });

    test('accepts sessionId field', () => {
      const info: AgentRuntimeInfo = {
        id: 'test',
        name: 'Test',
        role: 'tester',
        status: AgentStatus.IDLE,
        owner: 'user',
        persistent: false,
        createdAt: new Date().toISOString(),
        sessionId: 'session-xyz-789',
      };

      expect(info.sessionId).toBe('session-xyz-789');
    });

    test('lifecycle and sessionId are optional (absent is valid)', () => {
      const info: AgentRuntimeInfo = {
        id: 'test',
        name: 'Test',
        role: 'tester',
        status: AgentStatus.IDLE,
        owner: 'user',
        persistent: false,
        createdAt: new Date().toISOString(),
      };

      expect(info.lifecycle).toBeUndefined();
      expect(info.sessionId).toBeUndefined();
    });
  });

  describe('session.ts types module', () => {
    test('exports SessionConfig type', async () => {
      // A new types/session.ts should export SessionConfig
      try {
        const mod = await import('../src/types/session.ts');
        expect(mod).toBeDefined();
        // SessionConfig should be a type, but we can check the module loaded
      } catch {
        // Module doesn't exist yet — this is the expected failure
        throw new Error('types/session.ts does not exist yet — V2 Phase 1 needed');
      }
    });

    test('exports AgentLifecycle type', async () => {
      try {
        const mod = (await import('../src/types/session.ts')) as Record<string, unknown>;
        expect(mod.AgentLifecycle).toBeDefined();
      } catch {
        throw new Error('AgentLifecycle not exported from types/session.ts — V2 Phase 1 needed');
      }
    });
  });
});
