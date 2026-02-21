/**
 * Claude Backend Session — Tests for the stateless CLI mode fix.
 *
 * Background: The original implementation used --session-id on the first CLI call
 * and --resume on subsequent calls. This broke because -p (prompt mode) doesn't
 * reliably persist sessions to disk, causing --resume to always fail.
 *
 * Fix: Replaced session-id/resume logic with stateless --no-session-persistence.
 * Multi-turn context is handled by the conductor's memory system.
 *
 * These tests cover:
 *  1. Regression: --session-id and --resume are never used (fix validation)
 *  2. --no-session-persistence is always present in CLI args
 *  3. _alive stays true after failed sendStreaming/send (remaining bug)
 *  4. Edge cases: sessionId in config is ignored, exit code handling, rapid sends
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { StreamEvent } from '@autonomy/shared';
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
            controller.enqueue(new TextEncoder().encode('mock response'));
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

describe('ClaudeProcess stateless mode', () => {
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
  // 1. Regression: --session-id and --resume are never used
  // ============================================================
  describe('regression: no session-id/resume flags', () => {
    test('never uses --session-id even when sessionId is in config', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        sessionId: 'sess-123',
      });

      await proc.send('Hello');
      await proc.send('World');

      for (const args of spawnControl.capturedArgs) {
        expect(args).not.toContain('--session-id');
        expect(args).not.toContain('--resume');
      }
    });

    test('never uses --resume on subsequent sends', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        sessionId: 'sess-multi',
      });

      await proc.send('First');
      await proc.send('Second');
      await proc.send('Third');

      for (const args of spawnControl.capturedArgs) {
        expect(args).not.toContain('--resume');
      }
    });

    test('sendStreaming never uses --session-id or --resume', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        sessionId: 'sess-stream',
      });

      if (proc.sendStreaming) {
        for await (const _event of proc.sendStreaming('First')) {
          // consume
        }
        for await (const _event of proc.sendStreaming('Second')) {
          // consume
        }
      }

      for (const args of spawnControl.capturedArgs) {
        expect(args).not.toContain('--session-id');
        expect(args).not.toContain('--resume');
      }
    });
  });

  // ============================================================
  // 2. --no-session-persistence is always present
  // ============================================================
  describe('--no-session-persistence flag', () => {
    test('always includes --no-session-persistence', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('Hello');
      expect(spawnControl.capturedArgs[0]).toContain('--no-session-persistence');
    });

    test('includes --no-session-persistence even when sessionId is provided', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        sessionId: 'sess-ignored',
      });

      await proc.send('Hello');
      expect(spawnControl.capturedArgs[0]).toContain('--no-session-persistence');
    });

    test('includes --no-session-persistence on every send call', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('First');
      await proc.send('Second');
      await proc.send('Third');

      for (const args of spawnControl.capturedArgs) {
        expect(args).toContain('--no-session-persistence');
      }
    });

    test('includes --no-session-persistence in sendStreaming calls', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      if (proc.sendStreaming) {
        for await (const _event of proc.sendStreaming('Hello')) {
          // consume
        }
      }

      expect(spawnControl.capturedArgs[0]).toContain('--no-session-persistence');
    });
  });

  // ============================================================
  // 3. Core CLI args are always correct
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

    test('--dangerously-skip-permissions is NOT included by default', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.send('Hello');
      expect(spawnControl.capturedArgs[0]).not.toContain('--dangerously-skip-permissions');
    });

    test('--dangerously-skip-permissions is included when skipPermissions is true', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        skipPermissions: true,
      });

      await proc.send('Hello');
      expect(spawnControl.capturedArgs[0]).toContain('--dangerously-skip-permissions');
    });

    test('--system-prompt is passed through', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'You are a helpful assistant.',
      });

      await proc.send('Hello');
      const args = spawnControl.capturedArgs[0];
      expect(args).toContain('--system-prompt');
      const idx = args.indexOf('--system-prompt');
      expect(args[idx + 1]).toBe('You are a helpful assistant.');
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
  // 4. _alive behavior after errors (remaining issue to monitor)
  // ============================================================
  describe('_alive after errors', () => {
    test('process stays alive after sendStreaming yields error event', async () => {
      spawnControl.setExitCodes([1]);

      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      expect(proc.alive).toBe(true);

      const events: StreamEvent[] = [];
      if (proc.sendStreaming) {
        for await (const event of proc.sendStreaming('Hello')) {
          events.push(event);
        }
      }

      // Verify we got an error event
      expect(events.some((e) => e.type === 'error')).toBe(true);

      // Note: _alive stays true after sendStreaming error.
      // In stateless mode this is acceptable since each send spawns a fresh CLI process.
      // The process object is reusable for subsequent independent calls.
      expect(proc.alive).toBe(true);
    });

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

      // In stateless mode, alive staying true is acceptable:
      // each send() spawns a new CLI process, so a transient failure
      // doesn't mean the next call will fail.
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

      // Since alive is true, we can retry and succeed
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
  // 5. Error handling
  // ============================================================
  describe('error handling', () => {
    test('send() throws BackendError on exit code 1', async () => {
      spawnControl.setExitCodes([1]);

      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await expect(proc.send('Hello')).rejects.toThrow('Process exited with code 1');
    });

    test('sendStreaming yields error event on exit code 1', async () => {
      spawnControl.setExitCodes([1]);

      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      const events: StreamEvent[] = [];
      if (proc.sendStreaming) {
        for await (const event of proc.sendStreaming('Hello')) {
          events.push(event);
        }
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent as { error: string }).error).toContain('Backend exited with code 1');
    });

    test('sendStreaming yields complete event on success', async () => {
      spawnControl.setExitCodes([0]);

      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      const events: StreamEvent[] = [];
      if (proc.sendStreaming) {
        for await (const event of proc.sendStreaming('Hello')) {
          events.push(event);
        }
      }

      expect(events.some((e) => e.type === 'chunk')).toBe(true);
      expect(events[events.length - 1].type).toBe('complete');
    });
  });

  // ============================================================
  // 6. Concurrent sends in stateless mode
  // ============================================================
  describe('concurrent sends', () => {
    test('concurrent sends all use --no-session-persistence', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await Promise.all([proc.send('Msg1'), proc.send('Msg2'), proc.send('Msg3')]);

      for (const args of spawnControl.capturedArgs) {
        expect(args).toContain('--no-session-persistence');
        expect(args).not.toContain('--session-id');
        expect(args).not.toContain('--resume');
      }
    });

    test('concurrent sends are independent (no shared session state)', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      const [r1, r2, r3] = await Promise.all([
        proc.send('Msg1'),
        proc.send('Msg2'),
        proc.send('Msg3'),
      ]);

      // All calls return independently
      expect(r1).toBe('mock response');
      expect(r2).toBe('mock response');
      expect(r3).toBe('mock response');
      expect(spawnControl.capturedArgs.length).toBe(3);
    });
  });

  // ============================================================
  // 7. Edge cases
  // ============================================================
  describe('edge cases', () => {
    test('sessionId in config is ignored (stateless mode)', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        sessionId: 'sess-should-be-ignored',
      });

      await proc.send('Hello');
      const args = spawnControl.capturedArgs[0];
      expect(args).toContain('--no-session-persistence');
      expect(args).not.toContain('--session-id');
      expect(args).not.toContain('sess-should-be-ignored');
    });

    test('empty string sessionId causes no issues', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
        sessionId: '',
      });

      await proc.send('Hello');
      const args = spawnControl.capturedArgs[0];
      expect(args).toContain('--no-session-persistence');
      expect(args).not.toContain('--session-id');
    });

    test('stop() is idempotent', async () => {
      const proc = await backend.spawn({
        agentId: 'test-agent',
        systemPrompt: 'Test',
      });

      await proc.stop();
      await proc.stop(); // should not throw
      expect(proc.alive).toBe(false);
    });
  });
});
