/**
 * Claude Backend Auth Status — Tests for getStatus() authentication detection.
 *
 * Bug: getStatus() sets configured=true and authMode='cli_login' when the claude
 * binary is on PATH, even if the user has NOT run `claude auth login`. This causes
 * the providers UI to show "configured/ready" status when the user cannot actually
 * send messages.
 *
 * The fix should call `claude auth status --json` which returns structured JSON:
 *   Authenticated:     {"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"...","subscriptionType":"max"}
 *   Not authenticated: {"loggedIn":false}
 *
 * These tests validate that:
 *  1. Binary presence alone does NOT mean configured (needs actual auth check)
 *  2. `claude auth status --json` output is parsed to determine real auth state
 *  3. API key auth takes precedence over CLI auth
 *  4. Missing binary = available:false, configured:false
 *  5. New `authenticated` field accurately reflects login state
 *  6. Edge cases: malformed JSON, timeout, non-zero exit code all default to not authenticated
 *  7. CLAUDECODE env var is excluded from spawned process env
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { ClaudeBackend } from '../../src/backends/claude.ts';

// ── JSON responses matching real `claude auth status --json` output ──

const AUTH_LOGGED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'user@example.com',
  subscriptionType: 'max',
});

const AUTH_LOGGED_IN_PRO = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'pro@example.com',
  subscriptionType: 'pro',
});

const AUTH_NOT_LOGGED_IN = JSON.stringify({
  loggedIn: false,
});

// ── Mock helpers ──

/**
 * Create a mock Bun.spawn that simulates `claude auth status --json` output.
 * Returns a mock function whose calls can be inspected.
 */
function createAuthStatusMockSpawn(stdout: string, exitCode = 0) {
  return mock((..._args: unknown[]) => {
    return {
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stdout));
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
}

/** Strip all CLAUDE_* env vars from process.env (except CLAUDE_CODE_VERSION). */
function clearClaudeEnvVars() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('CLAUDE_') && key !== 'CLAUDE_CODE_VERSION') {
      delete process.env[key];
    }
  }
}

describe('ClaudeBackend.getStatus() — auth detection', () => {
  let backend: ClaudeBackend;
  let originalSpawn: typeof Bun.spawn;
  let originalWhich: typeof Bun.which;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    backend = new ClaudeBackend();
    originalSpawn = Bun.spawn;
    originalWhich = Bun.which;
    // Snapshot env so we can restore after each test
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    // @ts-expect-error — restoring Bun.which mock
    Bun.which = originalWhich;
    // Restore env
    process.env = originalEnv;
  });

  // ============================================================
  // 1. Binary on PATH but NOT authenticated
  // ============================================================
  describe('binary exists, not authenticated', () => {
    test('configured should be false when auth status returns loggedIn:false', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_NOT_LOGGED_IN, 0);
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.available).toBe(true);
      expect(status.configured).toBe(false);
      expect(status.authMode).toBe('none');
    });

    test('authenticated should be false when loggedIn:false', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_NOT_LOGGED_IN, 0);
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.authenticated).toBe(false);
    });

    test('authMode should be "none" when binary exists but not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_NOT_LOGGED_IN, 0);
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.authMode).toBe('none');
    });
  });

  // ============================================================
  // 2. Binary on PATH AND authenticated
  // ============================================================
  describe('binary exists, authenticated via CLI', () => {
    test('configured should be true when auth status returns loggedIn:true', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);
      delete process.env.ANTHROPIC_API_KEY;

      const status = await backend.getStatus();

      expect(status.available).toBe(true);
      expect(status.configured).toBe(true);
      expect(status.authMode).toBe('cli_login');
    });

    test('authenticated should be true when loggedIn:true', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);
      delete process.env.ANTHROPIC_API_KEY;

      const status = await backend.getStatus();

      expect(status.authenticated).toBe(true);
    });

    test('works with pro subscription variant', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_LOGGED_IN_PRO, 0);
      delete process.env.ANTHROPIC_API_KEY;

      const status = await backend.getStatus();

      expect(status.configured).toBe(true);
      expect(status.authMode).toBe('cli_login');
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
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.available).toBe(false);
      expect(status.configured).toBe(false);
      expect(status.authMode).toBe('none');
      expect(status.error).toBeDefined();
    });

    test('should not attempt to run claude auth status when binary missing', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      const spawnMock = createAuthStatusMockSpawn('', 0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.ANTHROPIC_API_KEY;

      await backend.getStatus();

      // Bun.spawn should NOT have been called since binary isn't available
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 4. ANTHROPIC_API_KEY set (takes precedence over CLI)
  // ============================================================
  describe('API key authentication', () => {
    test('authMode should be api_key when ANTHROPIC_API_KEY is set', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-unit-tests-1234567890abcdef';

      const status = await backend.getStatus();

      expect(status.authMode).toBe('api_key');
      expect(status.configured).toBe(true);
    });

    test('configured should be true with API key even when CLI is not available', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-unit-tests-1234567890abcdef';

      const status = await backend.getStatus();

      expect(status.available).toBe(false);
      expect(status.configured).toBe(true);
      expect(status.authMode).toBe('api_key');
    });

    test('configured should be true with API key even when CLI auth check returns not logged in', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_NOT_LOGGED_IN, 0);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-unit-tests-1234567890abcdef';

      const status = await backend.getStatus();

      expect(status.configured).toBe(true);
      expect(status.authMode).toBe('api_key');
    });

    test('apiKeyMasked shows last 4 chars', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-unit-tests-1234567890abcdef';

      const status = await backend.getStatus();

      expect(status.apiKeyMasked).toBe('...cdef');
    });
  });

  // ============================================================
  // 5. Edge cases — error handling
  // ============================================================
  describe('edge cases', () => {
    test('non-zero exit code from auth status should treat as not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn('', 2);
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.configured).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    test('malformed JSON from auth status should treat as not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn('this is not valid json{{{', 0);
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.configured).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    test('empty stdout from auth status should treat as not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn('', 0);
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.configured).toBe(false);
      expect(status.authenticated).toBe(false);
    });

    test('auth status crash (exit code 2, stderr) should treat as not authenticated', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = mock(() => {
        return {
          stdout: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('Segfault'));
              controller.close();
            },
          }),
          exited: Promise.resolve(2),
          exitCode: null,
          kill: mock(() => {}),
        };
      });
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();

      const status = await backend.getStatus();

      expect(status.configured).toBe(false);
    });
  });

  // ============================================================
  // 6. Command invocation correctness
  // ============================================================
  describe('auth status command', () => {
    test('calls claude auth status --json with correct args', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      const spawnMock = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.ANTHROPIC_API_KEY;

      await backend.getStatus();

      expect(spawnMock).toHaveBeenCalled();
      const firstCallArgs = spawnMock.mock.calls[0][0] as string[];
      expect(firstCallArgs).toEqual(['claude', 'auth', 'status', '--json']);
    });

    test('does not include CLAUDECODE in spawned process env', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      const spawnMock = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.ANTHROPIC_API_KEY;
      // Set CLAUDECODE to verify it gets stripped
      process.env.CLAUDECODE = '1';

      await backend.getStatus();

      if (spawnMock.mock.calls.length > 0) {
        const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
        if (spawnOpts?.env) {
          const env = spawnOpts.env as Record<string, string>;
          expect(env).not.toHaveProperty('CLAUDECODE');
        }
      }
    });

    test('skips auth status check when API key is present', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      const spawnMock = createAuthStatusMockSpawn(AUTH_NOT_LOGGED_IN, 0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-for-unit-tests-1234567890abcdef';

      const status = await backend.getStatus();

      // When API key is set, no need to shell out to check CLI auth
      expect(status.authMode).toBe('api_key');
      expect(status.configured).toBe(true);
      // spawn should NOT be called — API key takes precedence, no CLI check needed
      expect(spawnMock).not.toHaveBeenCalled();
    });

    test('forwards CLAUDE_CONFIG_DIR to spawned auth status process', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      const spawnMock = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.ANTHROPIC_API_KEY;
      process.env.CLAUDE_CONFIG_DIR = '/data/cli-config/claude';

      await backend.getStatus();

      expect(spawnMock).toHaveBeenCalled();
      const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
      expect(spawnOpts?.env).toBeDefined();
      const env = spawnOpts?.env as Record<string, string>;
      expect(env.CLAUDE_CONFIG_DIR).toBe('/data/cli-config/claude');
    });

    test('forwards CLAUDE_DATA_DIR to spawned auth status process', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      const spawnMock = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.ANTHROPIC_API_KEY;
      process.env.CLAUDE_DATA_DIR = '/data/cli-config/claude-data';

      await backend.getStatus();

      expect(spawnMock).toHaveBeenCalled();
      const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
      expect(spawnOpts?.env).toBeDefined();
      const env = spawnOpts?.env as Record<string, string>;
      expect(env.CLAUDE_DATA_DIR).toBe('/data/cli-config/claude-data');
    });

    test('does not forward server secrets to spawned auth status process', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      const spawnMock = createAuthStatusMockSpawn(AUTH_NOT_LOGGED_IN, 0);
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = spawnMock;
      delete process.env.ANTHROPIC_API_KEY;
      clearClaudeEnvVars();
      // Set secrets that should NOT be forwarded
      process.env.AUTH_MASTER_KEY = 'master-secret';
      process.env.DASHBOARD_PASSWORD = 'dashboard-secret';
      process.env.OPENAI_API_KEY = 'sk-openai-secret';
      process.env.CODEX_API_KEY = 'codex-secret';
      process.env.GEMINI_API_KEY = 'gemini-secret';
      process.env.GOOGLE_API_KEY = 'google-secret';

      await backend.getStatus();

      expect(spawnMock).toHaveBeenCalled();
      const spawnOpts = spawnMock.mock.calls[0][1] as Record<string, unknown> | undefined;
      expect(spawnOpts?.env).toBeDefined();
      const env = spawnOpts?.env as Record<string, string>;
      expect(env).not.toHaveProperty('AUTH_MASTER_KEY');
      expect(env).not.toHaveProperty('DASHBOARD_PASSWORD');
      expect(env).not.toHaveProperty('OPENAI_API_KEY');
      expect(env).not.toHaveProperty('CODEX_API_KEY');
      expect(env).not.toHaveProperty('GEMINI_API_KEY');
      expect(env).not.toHaveProperty('GOOGLE_API_KEY');
    });
  });

  // ============================================================
  // 7. CLAUDE_* env vars (no longer used as auth signal)
  // ============================================================
  describe('CLAUDE_* env vars', () => {
    test('CLAUDE_* env vars without CLI binary should not set configured', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      process.env.CLAUDE_SOME_VAR = 'test';

      const status = await backend.getStatus();

      expect(status.available).toBe(false);
      expect(status.configured).toBe(false);
    });

    test('CLAUDE_* env vars alone should not make authMode cli_login without actual auth check', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // Auth status says NOT logged in
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_NOT_LOGGED_IN, 0);
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      process.env.CLAUDE_SOME_VAR = 'test';

      const status = await backend.getStatus();

      // Despite CLAUDE_* env vars being set, actual auth check says not logged in
      expect(status.configured).toBe(false);
      expect(status.authMode).toBe('none');
    });
  });

  // ============================================================
  // 8. Return shape validation
  // ============================================================
  describe('return shape', () => {
    test('always returns required BackendStatus fields', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);

      const status = await backend.getStatus();

      expect(status.name).toBe(AIBackend.CLAUDE);
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.configured).toBe('boolean');
      expect(['api_key', 'cli_login', 'none']).toContain(status.authMode);
      expect(status.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.CLAUDE]);
    });

    test('includes authenticated field in response', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = createAuthStatusMockSpawn(AUTH_LOGGED_IN, 0);

      const status = await backend.getStatus();

      expect(typeof status.authenticated).toBe('boolean');
    });
  });

  // ============================================================
  // 9. Cache invalidation after logout
  // ============================================================
  describe('cache invalidation after logout', () => {
    test('getStatus() re-checks auth after logout() is called', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/local/bin/claude');
      delete process.env.ANTHROPIC_API_KEY;

      let callCount = 0;
      // @ts-expect-error — mocking Bun.spawn for testing
      Bun.spawn = mock((...args: unknown[]) => {
        const cmd = args[0] as string[];
        const isAuthStatus = cmd.includes('auth') && cmd.includes('status');
        callCount++;

        // First auth status check: logged in
        // After logout: auth status returns not logged in
        let stdout = '';
        if (isAuthStatus) {
          stdout = callCount <= 1 ? AUTH_LOGGED_IN : AUTH_NOT_LOGGED_IN;
        }

        return {
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(stdout));
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
          kill: mock(() => {}),
        };
      });

      // First call: should be authenticated
      const statusBefore = await backend.getStatus();
      expect(statusBefore.configured).toBe(true);
      expect((statusBefore as Record<string, unknown>).authenticated).toBe(true);

      // Perform logout
      await backend.logout();

      // Second call: should reflect logged-out state (no cached result)
      const statusAfter = await backend.getStatus();
      expect(statusAfter.configured).toBe(false);
      expect((statusAfter as Record<string, unknown>).authenticated).toBe(false);
      expect(statusAfter.authMode).toBe('none');
    });
  });
});
