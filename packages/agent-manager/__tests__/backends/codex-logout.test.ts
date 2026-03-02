/**
 * Codex Backend Logout — Tests for CodexBackend.logout().
 *
 * Validates that:
 *  1. logout() calls `codex logout` via Bun.spawn
 *  2. Throws BackendError on non-zero exit code with stderr content
 *  3. Uses buildSafeEnv for process environment isolation
 *  4. Succeeds silently on exit code 0
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { CodexBackend } from '../../src/backends/codex.ts';

function createMockSpawn(exitCode: number, stderr = '') {
  return mock((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          if (stderr) controller.enqueue(new TextEncoder().encode(stderr));
          controller.close();
        },
      }),
      exited: Promise.resolve(exitCode),
      exitCode: null,
      kill: mock(() => {}),
    };
  });
}

describe('CodexBackend.logout()', () => {
  let backend: CodexBackend;
  let originalSpawn: typeof Bun.spawn;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    backend = new CodexBackend();
    originalSpawn = Bun.spawn;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    process.env = originalEnv;
  });

  test('logout method exists on CodexBackend', () => {
    expect(typeof backend.logout).toBe('function');
  });

  test('calls codex logout via Bun.spawn', async () => {
    const spawnMock = createMockSpawn(0);
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = spawnMock;

    await backend.logout();

    expect(spawnMock).toHaveBeenCalled();
    const args = spawnMock.mock.calls[0][0] as string[];
    expect(args).toEqual(['codex', 'logout']);
  });

  test('succeeds silently on exit code 0', async () => {
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = createMockSpawn(0);

    // Should not throw
    await backend.logout();
  });

  test('throws BackendError when exit code is non-zero', async () => {
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = createMockSpawn(1, 'not logged in');

    await expect(backend.logout()).rejects.toThrow('Logout failed');
  });

  test('includes stderr content in error message', async () => {
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = createMockSpawn(1, 'authentication error: session expired');

    await expect(backend.logout()).rejects.toThrow('session expired');
  });

  test('does not leak ANTHROPIC_API_KEY in spawned env', async () => {
    const spawnMock = createMockSpawn(0);
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = spawnMock;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-should-not-leak';

    await backend.logout();

    const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
    expect(spawnOpts?.env).toBeDefined();
    const env = spawnOpts!.env as Record<string, string>;
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });
});
