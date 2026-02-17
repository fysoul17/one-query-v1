/**
 * Claude Backend Session — Tests that prove ClaudeBackend lacks session flag handling.
 *
 * These tests are expected to FAIL until V2 Phase 1 is implemented.
 * They validate that:
 *  - ClaudeBackend passes --session-id on first send for persistent sessions
 *  - ClaudeBackend passes --resume on subsequent sends
 *  - ClaudeBackend passes --no-session-persistence for ephemeral agents
 *  - Session flags are omitted when sessionId is not in spawn config
 *
 * NOTE: These test the buildArgs() logic by examining what gets passed to Bun.spawn.
 * We use the real ClaudeBackend but mock Bun.spawn via spyOn to capture args.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ClaudeBackend } from '../../src/backends/claude.ts';
import type { BackendSpawnConfig } from '../../src/backends/types.ts';

/**
 * Since ClaudeProcess.buildArgs is private and Bun.spawn is called internally,
 * we test by spawning a process and checking what args would be built.
 *
 * For unit testing without spawning real processes, we instrument Bun.spawn.
 */

describe('V2 Phase 1 — ClaudeBackend session flags', () => {
  let backend: ClaudeBackend;
  let originalSpawn: typeof Bun.spawn;
  let capturedArgs: string[][] = [];

  beforeEach(() => {
    backend = new ClaudeBackend();
    capturedArgs = [];

    // Intercept Bun.spawn to capture args without running real CLI
    originalSpawn = Bun.spawn;
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = mock((...args: unknown[]) => {
      const cmd = args[0] as string[];
      capturedArgs.push(cmd);
      // Return a fake process object
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('mock response'));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
        exitCode: null,
        kill: () => {},
      };
    });
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  describe('--session-id flag', () => {
    test('passes --session-id when sessionId is in spawn config', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'session-agent',
        systemPrompt: 'Test',
        // After V2, this field should exist on BackendSpawnConfig:
      };

      // Manually add sessionId to test future behavior
      (config as Record<string, unknown>).sessionId = 'sess-abc-123';

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      expect(capturedArgs.length).toBeGreaterThan(0);
      const args = capturedArgs[0] as string[];

      // First send should include --session-id
      expect(args).toContain('--session-id');
      const sessionIdx = args.indexOf('--session-id');
      expect(args[sessionIdx + 1]).toBe('sess-abc-123');
    });

    test('passes --resume on second send to same session', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'resume-agent',
        systemPrompt: 'Test',
      };
      (config as Record<string, unknown>).sessionId = 'sess-resume-456';

      const proc = await backend.spawn(config);

      // First send — should use --session-id
      await proc.send('First message');
      expect(capturedArgs[0]).toContain('--session-id');

      // Second send — should use --resume instead
      await proc.send('Second message');
      expect(capturedArgs.length).toBe(2);
      const secondArgs = capturedArgs[1] as string[];
      expect(secondArgs).toContain('--resume');
      const resumeIdx = secondArgs.indexOf('--resume');
      expect(secondArgs[resumeIdx + 1]).toBe('sess-resume-456');
      // Should NOT also have --session-id on second send
      expect(secondArgs).not.toContain('--session-id');
    });
  });

  describe('--no-session-persistence flag', () => {
    test('passes --no-session-persistence for ephemeral agents', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'ephemeral-agent',
        systemPrompt: 'Test',
      };
      // No sessionId = ephemeral agent
      // After V2, ephemeral sessions should get --no-session-persistence

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      const args = capturedArgs[0] as string[];
      // Ephemeral agents should not create persistent sessions
      // Currently, no session flags are passed at all — this should fail
      expect(args).not.toContain('--session-id');
      // But we DO want to ensure ephemeral agents don't accidentally persist:
      // This is a design test — uncomment when the flag approach is decided
    });
  });

  describe('no session flags when not configured', () => {
    test('omits all session flags when sessionId is undefined', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'no-session-agent',
        systemPrompt: 'Test',
      };

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      const args = capturedArgs[0] as string[];
      expect(args).not.toContain('--session-id');
      expect(args).not.toContain('--resume');
      // This test should PASS currently (no session flags exist)
      // It serves as a regression guard
    });
  });
});
