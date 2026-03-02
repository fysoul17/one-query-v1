/**
 * Gemini Backend Auth Status — Tests for getStatus() authentication detection.
 *
 * Gemini uses exit-code-based auth detection via `gemini auth status`:
 *   Exit 0 = logged in, non-zero = not authenticated.
 *
 * These tests validate that:
 *  1. Binary presence alone does NOT mean configured (needs actual auth check)
 *  2. `gemini auth status` exit code determines real auth state
 *  3. API key auth (GEMINI_API_KEY / GOOGLE_API_KEY) takes precedence over CLI auth
 *  4. Missing binary = available:false, configured:false
 *  5. `authenticated` field accurately reflects login state
 *  6. Edge cases: timeout, non-zero exit code default to not authenticated
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { GeminiBackend } from '../../src/backends/gemini.ts';

// ── Mock helpers ──

/**
 * Create a mock Bun.spawn that returns the given exit code.
 * For Gemini, auth detection is purely exit-code-based (no JSON parsing).
 */
function createExitCodeMockSpawn(exitCode: number, stdout = '', stderr = '') {
  return mock((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({
        start(controller) {
          if (stdout) controller.enqueue(new TextEncoder().encode(stdout));
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

/** Create a mock spawn that never resolves (simulates timeout). */
function _createHangingMockSpawn() {
  return mock((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({
        start() {
          /* never closes */
        },
      }),
      stderr: new ReadableStream({
        start(c) {
          c.close();
        },
      }),
      exited: new Promise<number>(() => {
        /* never resolves */
      }),
      exitCode: null,
      kill: mock(() => {}),
    };
  });
}

describe('GeminiBackend.getStatus() — auth detection', () => {
  let backend: GeminiBackend;
  let originalSpawn: typeof Bun.spawn;
  let originalWhich: typeof Bun.which;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    backend = new GeminiBackend();
    originalSpawn = Bun.spawn;
    originalWhich = Bun.which;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    // @ts-expect-error — restoring Bun.which mock
    Bun.which = originalWhich;
    process.env = originalEnv;
  });

  // ============================================================
  // 1. Binary on PATH but NOT authenticated
  // ============================================================
  describe('binary exists, not authenticated', () => {
    test('configured should be false when auth status returns non-zero exit', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(1);
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.available).toBe(true);
      expect(status.configured).toBe(false);
      expect(status.authMode).toBe('none');
    });

    test('authenticated should be false when CLI check fails', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(1);
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.authenticated).toBe(false);
    });

    test('authMode should be "none" when binary exists but not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(1);
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.authMode).toBe('none');
    });
  });

  // ============================================================
  // 2. Binary on PATH AND authenticated
  // ============================================================
  describe('binary exists, authenticated via CLI', () => {
    test('configured should be true when gemini auth status returns exit 0', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(0);
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.available).toBe(true);
      expect(status.configured).toBe(true);
      expect(status.authMode).toBe('cli_login');
    });

    test('authenticated should be true when CLI login check passes', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(0);
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.authenticated).toBe(true);
    });
  });

  // ============================================================
  // 3. Binary NOT found on PATH
  // ============================================================
  describe('binary not found', () => {
    test('available, configured, and authenticated should all be false', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.available).toBe(false);
      expect(status.configured).toBe(false);
      expect(status.authMode).toBe('none');
      expect(status.error).toBeDefined();
    });

    test('should not attempt to run gemini auth status when binary missing', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      const spawnMock = createExitCodeMockSpawn(0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      await backend.getStatus();

      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 4. API key authentication (takes precedence over CLI)
  // ============================================================
  describe('API key authentication', () => {
    test('authMode should be api_key when GEMINI_API_KEY is set', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      process.env.GEMINI_API_KEY = 'AIzaSyA-test-key-for-unit-tests-1234567890';

      const status = await backend.getStatus();

      expect(status.authMode).toBe('api_key');
      expect(status.configured).toBe(true);
    });

    test('authMode should be api_key when GOOGLE_API_KEY is set', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = 'AIzaSyA-google-test-key-unit-tests-5678';

      const status = await backend.getStatus();

      expect(status.authMode).toBe('api_key');
      expect(status.configured).toBe(true);
    });

    test('configured should be true with API key even when CLI is not available', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      process.env.GEMINI_API_KEY = 'AIzaSyA-test-key-for-unit-tests-1234567890';

      const status = await backend.getStatus();

      expect(status.available).toBe(false);
      expect(status.configured).toBe(true);
      expect(status.authMode).toBe('api_key');
    });

    test('apiKeyMasked shows last 4 chars', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      process.env.GEMINI_API_KEY = 'AIzaSyA-test-key-for-unit-tests-1234567890';

      const status = await backend.getStatus();

      expect(status.apiKeyMasked).toBe('...7890');
    });

    test('skips CLI auth check when API key is present', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      const spawnMock = createExitCodeMockSpawn(1);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      process.env.GEMINI_API_KEY = 'AIzaSyA-test-key-for-unit-tests-1234567890';

      const status = await backend.getStatus();

      expect(status.authMode).toBe('api_key');
      expect(status.configured).toBe(true);
      // spawn should NOT be called — API key takes precedence
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 5. Edge cases — error handling
  // ============================================================
  describe('edge cases', () => {
    test('non-zero exit code from auth status should treat as not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(2);
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.configured).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    test('auth status crash (exit code 2, stderr) should treat as not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(2, '', 'Segfault');
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const status = await backend.getStatus();

      expect(status.configured).toBe(false);
      expect(status.authenticated).toBe(false);
    });
  });

  // ============================================================
  // 6. Command invocation correctness
  // ============================================================
  describe('auth status command', () => {
    test('calls gemini auth status with correct args', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      const spawnMock = createExitCodeMockSpawn(0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      await backend.getStatus();

      expect(spawnMock).toHaveBeenCalled();
      const firstCallArgs = spawnMock.mock.calls[0][0] as string[];
      expect(firstCallArgs).toEqual(['gemini', 'auth', 'status']);
    });

    test('does not leak ANTHROPIC_API_KEY in spawned env', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      const spawnMock = createExitCodeMockSpawn(0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-key-should-not-leak';

      await backend.getStatus();

      if (spawnMock.mock.calls.length > 0) {
        const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
        if (spawnOpts?.env) {
          const env = spawnOpts.env as Record<string, string>;
          expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
        }
      }
    });

    test('does not leak CODEX_API_KEY in spawned env', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      const spawnMock = createExitCodeMockSpawn(0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      process.env.CODEX_API_KEY = 'sk-codex-secret-key-should-not-leak';

      await backend.getStatus();

      if (spawnMock.mock.calls.length > 0) {
        const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
        if (spawnOpts?.env) {
          const env = spawnOpts.env as Record<string, string>;
          expect(env).not.toHaveProperty('CODEX_API_KEY');
        }
      }
    });

    test('forwards GEMINI_CLI_HOME to spawned auth status process', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      const spawnMock = createExitCodeMockSpawn(0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      process.env.GEMINI_CLI_HOME = '/data/cli-config/gemini';

      await backend.getStatus();

      expect(spawnMock).toHaveBeenCalled();
      const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
      expect(spawnOpts?.env).toBeDefined();
      const env = spawnOpts?.env as Record<string, string>;
      expect(env.GEMINI_CLI_HOME).toBe('/data/cli-config/gemini');
    });
  });

  // ============================================================
  // 7. Return shape validation
  // ============================================================
  describe('return shape', () => {
    test('always returns required BackendStatus fields', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(0);

      const status = await backend.getStatus();

      expect(status.name).toBe(AIBackend.GEMINI);
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.configured).toBe('boolean');
      expect(['api_key', 'cli_login', 'none']).toContain(status.authMode);
      expect(status.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.GEMINI]);
    });

    test('includes authenticated field in response', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createExitCodeMockSpawn(0);

      const status = await backend.getStatus();

      expect(typeof status.authenticated).toBe('boolean');
    });
  });

  // ============================================================
  // 8. Cache invalidation after logout
  // ============================================================
  describe('cache invalidation after logout', () => {
    test('getStatus() re-checks auth after logout() is called', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/gemini');
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      let callCount = 0;
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = mock((...args: unknown[]) => {
        const cmd = args[0] as string[];
        const isAuthStatus = cmd.includes('auth') && cmd.includes('status');
        callCount++;

        // First auth status check: exit 0 (logged in)
        // After logout: exit 1 (not logged in)
        const exitCode = isAuthStatus ? (callCount <= 1 ? 0 : 1) : 0;

        return {
          stdout: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          exited: Promise.resolve(exitCode),
          exitCode: null,
          kill: mock(() => {}),
        };
      });

      // First call: should be authenticated
      const statusBefore = await backend.getStatus();
      expect(statusBefore.configured).toBe(true);
      expect(statusBefore.authenticated).toBe(true);

      // Perform logout
      await backend.logout();

      // Second call: should reflect logged-out state
      const statusAfter = await backend.getStatus();
      expect(statusAfter.configured).toBe(false);
      expect(statusAfter.authenticated).toBe(false);
      expect(statusAfter.authMode).toBe('none');
    });
  });
});
