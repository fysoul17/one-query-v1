/**
 * Claude Backend Session — Tests for ClaudeBackend session handling.
 *
 * Current state: Stateless mode — each send() spawns an independent CLI invocation with
 * --no-session-persistence. No --session-id or --resume flags are used.
 *
 * NOTE: These test the buildArgs() logic by examining what gets passed to Bun.spawn.
 * We use the real ClaudeBackend but mock Bun.spawn via spyOn to capture args.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ClaudeBackend } from '../../src/backends/claude.ts';
import type { BackendSpawnConfig } from '../../src/backends/types.ts';

describe('ClaudeBackend session flags', () => {
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

  describe('stateless mode (current behavior)', () => {
    test('does not pass --session-id even when sessionId is in config', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'session-agent',
        systemPrompt: 'Test',
        sessionId: 'sess-abc-123',
      };

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      const args = capturedArgs[0] as string[];
      // Stateless mode: --no-session-persistence is used, no --session-id
      expect(args).not.toContain('--session-id');
      expect(args).toContain('--no-session-persistence');
    });

    test('does not pass --resume on subsequent sends', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'resume-agent',
        systemPrompt: 'Test',
        sessionId: 'sess-resume-456',
      };

      const proc = await backend.spawn(config);

      await proc.send('First message');
      await proc.send('Second message');

      expect(capturedArgs.length).toBe(2);
      // Neither call should have --resume in stateless mode
      expect(capturedArgs[0]).not.toContain('--resume');
      expect(capturedArgs[1]).not.toContain('--resume');
      // Both should have --no-session-persistence
      expect(capturedArgs[0]).toContain('--no-session-persistence');
      expect(capturedArgs[1]).toContain('--no-session-persistence');
    });
  });

  describe('--no-session-persistence flag', () => {
    test('passes --no-session-persistence for all agents', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'ephemeral-agent',
        systemPrompt: 'Test',
      };

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      const args = capturedArgs[0] as string[];
      expect(args).toContain('--no-session-persistence');
      expect(args).not.toContain('--session-id');
    });
  });

  describe('no session flags when not configured', () => {
    test('omits --session-id and --resume when sessionId is undefined', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'no-session-agent',
        systemPrompt: 'Test',
      };

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      const args = capturedArgs[0] as string[];
      expect(args).not.toContain('--session-id');
      expect(args).not.toContain('--resume');
    });
  });
});
