import { beforeEach, describe, expect, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { ClaudeBackend } from '../../src/backends/claude.ts';

/**
 * Check if `claude` CLI is available on PATH.
 * Integration tests that spawn real processes are skipped when it is absent (e.g. CI).
 */
let claudeAvailable = false;
try {
  const proc = Bun.spawnSync(['which', 'claude']);
  claudeAvailable = proc.exitCode === 0;
} catch {
  claudeAvailable = false;
}

const describeIntegration = claudeAvailable ? describe : describe.skip;

describe('ClaudeBackend', () => {
  let backend: ClaudeBackend;

  beforeEach(() => {
    backend = new ClaudeBackend();
  });

  describe('identity', () => {
    test('has name "claude"', () => {
      expect(backend.name).toBe('claude');
      expect(backend.name).toBe(AIBackend.CLAUDE);
    });

    test('exposes capabilities matching BACKEND_CAPABILITIES', () => {
      expect(backend.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.CLAUDE]);
    });

    test('capabilities include customTools: true', () => {
      expect(backend.capabilities.customTools).toBe(true);
    });

    test('capabilities include streaming: true', () => {
      expect(backend.capabilities.streaming).toBe(true);
    });

    test('capabilities include sessionPersistence: true', () => {
      expect(backend.capabilities.sessionPersistence).toBe(true);
    });

    test('capabilities include fileAccess: true', () => {
      expect(backend.capabilities.fileAccess).toBe(true);
    });
  });

  describeIntegration('spawn()', () => {
    test('returns a BackendProcess', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a test agent.',
        skipPermissions: true,
      });

      expect(proc).toBeDefined();
      expect(typeof proc.send).toBe('function');
      expect(typeof proc.stop).toBe('function');
      expect(typeof proc.alive).toBe('boolean');
    });

    test('spawned process starts alive', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a test agent.',
        skipPermissions: true,
      });
      expect(proc.alive).toBe(true);
    });

    test('accepts optional tools array', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a test agent.',
        tools: ['Read', 'Write', 'Bash'],
        skipPermissions: true,
      });
      expect(proc).toBeDefined();
      expect(proc.alive).toBe(true);
    });

    test('accepts optional cwd', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a test agent.',
        cwd: '/tmp',
        skipPermissions: true,
      });
      expect(proc).toBeDefined();
    });
  });

  describeIntegration('BackendProcess.send()', () => {
    test(
      'sends a prompt and returns a response string',
      async () => {
        const proc = await backend.spawn({
          agentId: 'test-agent',
          systemPrompt: 'You are a test agent. Reply with "ok".',
          skipPermissions: true,
        });

        const response = await proc.send('Hello');
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
      },
      { timeout: 30_000 },
    );
  });

  describeIntegration('BackendProcess.stop()', () => {
    test('terminates the process', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a test agent.',
        skipPermissions: true,
      });

      expect(proc.alive).toBe(true);
      await proc.stop();
      expect(proc.alive).toBe(false);
    });

    test('stop() is idempotent (no error on double stop)', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a test agent.',
        skipPermissions: true,
      });

      await proc.stop();
      await proc.stop(); // should not throw
      expect(proc.alive).toBe(false);
    });
  });

  describeIntegration('BackendProcess.alive', () => {
    test('reflects process state accurately', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a test agent.',
        skipPermissions: true,
      });

      expect(proc.alive).toBe(true);
      await proc.stop();
      expect(proc.alive).toBe(false);
    });
  });
});
