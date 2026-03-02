/**
 * Claude Backend Session Resume — Tests for native session persistence.
 *
 * Background: The original implementation used --no-session-persistence with stateless mode.
 * The new implementation captures session_id from CLI JSON output and uses --resume on
 * subsequent calls, enabling native multi-turn conversation in the CLI.
 *
 * These tests cover:
 *  1. --resume IS used on subsequent sends (with captured session_id)
 *  2. --output-format json is used for non-streaming (to capture session_id)
 *  3. --system-prompt only on first call (session stores it)
 *  4. _alive stays true after failed sendStreaming/send
 *  5. Edge cases: error handling, concurrent sends, stop behavior
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ClaudeBackend } from '../../src/backends/claude.ts';

/**
 * Helper to create a mock Bun.spawn that captures args and simulates process behavior.
 * Returns controls to customize exit codes and stdout for each invocation.
 */
function createMockSpawn() {
  const capturedArgs: string[][] = [];
  const capturedOptions: Record<string, unknown>[] = [];
  let exitCodeSequence: number[] = [0];
  let callIndex = 0;

  const mockFn = mock((...args: unknown[]) => {
    const cmd = args[0] as string[];
    const opts = (args[1] ?? {}) as Record<string, unknown>;
    capturedArgs.push([...cmd]);
    capturedOptions.push(opts);

    const currentExitCode = exitCodeSequence[callIndex % exitCodeSequence.length] ?? 0;
    callIndex++;

    return {
      stdout: new ReadableStream({
        start(controller) {
          if (currentExitCode === 0) {
            // Return JSON with session_id on success
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ session_id: `sess-${callIndex}`, result: 'mock response' }),
              ),
            );
          }
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          if (currentExitCode !== 0) {
            controller.enqueue(new TextEncoder().encode('Error: backend failure'));
          }
          controller.close();
        },
      }),
      exited: Promise.resolve(currentExitCode),
      exitCode: null,
      kill: mock(() => {}),
    };
  });

  return {
    mockFn,
    capturedArgs,
    capturedOptions,
    setExitCodes(codes: number[]) {
      exitCodeSequence = codes;
    },
    reset() {
      capturedArgs.length = 0;
      capturedOptions.length = 0;
      callIndex = 0;
    },
  };
}

describe('ClaudeProcess session resume mode', () => {
  let backend: ClaudeBackend;
  let originalSpawn: typeof Bun.spawn;
  let spawnControl: ReturnType<typeof createMockSpawn>;

  beforeEach(() => {
    backend = new ClaudeBackend();
    spawnControl = createMockSpawn();

    // Intercept Bun.spawn
    originalSpawn = Bun.spawn;
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = spawnControl.mockFn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  // ============================================================
  // 1. --resume IS used on subsequent sends
  // ============================================================
  describe('session resume with --resume flag', () => {
    test('first call has no --resume, second call uses --resume', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('Hello');
      await proc.send('World');

      // First call: no --resume
      expect(spawnControl.capturedArgs[0]).not.toContain('--resume');
      // Second call: --resume with session_id
      expect(spawnControl.capturedArgs[1]).toContain('--resume');
    });

    test('all calls after first use --resume', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('First');
      await proc.send('Second');
      await proc.send('Third');

      expect(spawnControl.capturedArgs[0]).not.toContain('--resume');
      expect(spawnControl.capturedArgs[1]).toContain('--resume');
      expect(spawnControl.capturedArgs[2]).toContain('--resume');
    });
  });

  // ============================================================
  // 2. --output-format json for session_id capture
  // ============================================================
  describe('JSON output format', () => {
    test('non-streaming send uses --output-format json', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('Hello');
      const args = spawnControl.capturedArgs[0];
      const fmtIdx = args.indexOf('--output-format');
      expect(fmtIdx).toBeGreaterThan(-1);
      expect(args[fmtIdx + 1]).toBe('json');
    });
  });

  // ============================================================
  // 3. --system-prompt only on first call
  // ============================================================
  describe('system prompt on first call only', () => {
    test('first call includes --system-prompt', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a helpful assistant.',
      });

      await proc.send('Hello');
      expect(spawnControl.capturedArgs[0]).toContain('--system-prompt');
    });

    test('subsequent calls omit --system-prompt', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a helpful assistant.',
      });

      await proc.send('Hello');
      await proc.send('World');

      expect(spawnControl.capturedArgs[0]).toContain('--system-prompt');
      expect(spawnControl.capturedArgs[1]).not.toContain('--system-prompt');
    });
  });

  // ============================================================
  // 4. Core CLI args are always correct
  // ============================================================
  describe('core CLI args', () => {
    test('every send uses -p flag (prompt mode)', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('First');
      await proc.send('Second');

      expect(spawnControl.capturedArgs[0]).toContain('-p');
      expect(spawnControl.capturedArgs[1]).toContain('-p');
    });

    test('--dangerously-skip-permissions only on first call when enabled', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        skipPermissions: true,
      });

      await proc.send('Hello');
      await proc.send('World');

      expect(spawnControl.capturedArgs[0]).toContain('--dangerously-skip-permissions');
      // Subsequent calls omit config flags
      expect(spawnControl.capturedArgs[1]).not.toContain('--dangerously-skip-permissions');
    });

    test('message is passed as -p argument', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('My test message');
      const args = spawnControl.capturedArgs[0];
      const pIdx = args.indexOf('-p');
      expect(args[pIdx + 1]).toBe('My test message');
    });
  });

  // ============================================================
  // 5. _alive behavior after errors
  // ============================================================
  describe('_alive after errors', () => {
    test('process stays alive after send() throws BackendError', async () => {
      spawnControl.setExitCodes([1]);

      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      try {
        await proc.send('Hello');
      } catch {
        // Expected: BackendError
      }

      expect(proc.alive).toBe(true);
    });

    test('process can recover after transient failure', async () => {
      // First call fails, second succeeds
      spawnControl.setExitCodes([1, 0]);

      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      try {
        await proc.send('First');
      } catch {
        // Expected
      }

      const result = await proc.send('Second');
      expect(result).toBe('mock response');
    });

    test('after stop(), send() throws "Process is not alive"', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.stop();
      expect(proc.alive).toBe(false);
      await expect(proc.send('Hello')).rejects.toThrow('Process is not alive');
    });
  });

  // ============================================================
  // 6. Edge cases
  // ============================================================
  describe('edge cases', () => {
    test('stop() is idempotent', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.stop();
      await proc.stop(); // should not throw
      expect(proc.alive).toBe(false);
    });

    test('no --no-session-persistence flag (session mode)', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('Hello');
      expect(spawnControl.capturedArgs[0]).not.toContain('--no-session-persistence');
    });
  });

  // ============================================================
  // 7. Session restore from config.sessionId
  // ============================================================
  describe('session restore from config.sessionId', () => {
    test('nativeSessionId is immediately set from config.sessionId', async () => {
      const proc = await backend.spawn({
        agentId: 'test',
        systemPrompt: 'Test',
        sessionId: 'restored-sess-123',
      });

      // Before any send(), nativeSessionId should be restored
      expect(proc.nativeSessionId).toBe('restored-sess-123');
    });

    test('first send() uses --resume with restored session ID', async () => {
      const proc = await backend.spawn({
        agentId: 'test',
        systemPrompt: 'Test',
        sessionId: 'restored-sess-123',
      });

      await proc.send('Hello after restore');

      const args = spawnControl.capturedArgs[0];
      expect(args).toContain('--resume');
      const resumeIdx = args.indexOf('--resume');
      expect(args[resumeIdx + 1]).toBe('restored-sess-123');
    });

    test('first send() does NOT include --system-prompt (firstCallDone is true)', async () => {
      const proc = await backend.spawn({
        agentId: 'test',
        systemPrompt: 'Test',
        sessionId: 'restored-sess-123',
      });

      await proc.send('Hello after restore');

      expect(spawnControl.capturedArgs[0]).not.toContain('--system-prompt');
    });

    test('first send() does NOT include --dangerously-skip-permissions', async () => {
      const proc = await backend.spawn({
        agentId: 'test',
        systemPrompt: 'Test',
        sessionId: 'restored-sess-123',
        skipPermissions: true,
      });

      await proc.send('Hello after restore');

      // Config flags are skipped when _firstCallDone is true
      expect(spawnControl.capturedArgs[0]).not.toContain('--dangerously-skip-permissions');
    });
  });
});
