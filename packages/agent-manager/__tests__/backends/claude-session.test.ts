/**
 * Claude Backend Session — Tests for ClaudeBackend session resume handling.
 *
 * Current state: Session-persistent mode — first send() captures a session_id from
 * JSON output, subsequent sends use --resume <id> to continue the conversation natively.
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
      // Return a fake process with JSON output containing session_id
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ session_id: 'sess-abc-001', result: 'mock response' }),
              ),
            );
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

  describe('session resume mode', () => {
    test('first call uses -p without --resume', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'session-agent',
        systemPrompt: 'Test',
      };

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      const args = capturedArgs[0] as string[];
      expect(args).toContain('-p');
      expect(args).not.toContain('--resume');
      // No --no-session-persistence in session mode
      expect(args).not.toContain('--no-session-persistence');
    });

    test('second call uses --resume with captured session_id', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'resume-agent',
        systemPrompt: 'Test',
      };

      const proc = await backend.spawn(config);

      await proc.send('First message');
      await proc.send('Second message');

      expect(capturedArgs.length).toBe(2);
      // First call: no --resume
      expect(capturedArgs[0]).not.toContain('--resume');
      // Second call: --resume with the session_id
      expect(capturedArgs[1]).toContain('--resume');
      expect(capturedArgs[1]).toContain('sess-abc-001');
    });

    test('first call includes --system-prompt, subsequent calls do not', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'resume-agent',
        systemPrompt: 'You are a helper',
      };

      const proc = await backend.spawn(config);
      await proc.send('First');
      await proc.send('Second');

      // First call has system prompt
      expect(capturedArgs[0]).toContain('--system-prompt');
      // Second call omits it (session stores it)
      expect(capturedArgs[1]).not.toContain('--system-prompt');
    });
  });

  describe('--output-format json for send()', () => {
    test('non-streaming send uses --output-format json', async () => {
      const config: BackendSpawnConfig = {
        agentId: 'json-agent',
        systemPrompt: 'Test',
      };

      const proc = await backend.spawn(config);
      await proc.send('Hello');

      const args = capturedArgs[0] as string[];
      expect(args).toContain('--output-format');
      const fmtIdx = args.indexOf('--output-format');
      expect(args[fmtIdx + 1]).toBe('json');
    });
  });

  describe('nativeSessionId getter', () => {
    test('nativeSessionId is undefined before first send', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });
      expect(proc.nativeSessionId).toBeUndefined();
    });

    test('nativeSessionId is set after first send', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });
      await proc.send('Hello');
      expect(proc.nativeSessionId).toBe('sess-abc-001');
    });
  });
});
