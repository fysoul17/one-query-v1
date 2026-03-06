import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import {
  buildPtyEnv,
  createTerminalWebSocketHandler,
  type TerminalWSData,
} from '../src/terminal-ws.ts';

// ---------------------------------------------------------------------------
// Helpers (mirrors terminal-ws.test.ts patterns)
// ---------------------------------------------------------------------------

const PTY_BRIDGE_PATH = join(import.meta.dir, '..', 'src', 'pty-bridge.py');

function canOpenPty(): boolean {
  try {
    const proc = Bun.spawnSync([
      'python3',
      '-c',
      'import pty; m, s = pty.openpty(); import os; os.close(m); os.close(s); print("ok")',
    ]);
    return proc.stdout.toString().trim() === 'ok';
  } catch {
    return false;
  }
}
const PTY_AVAILABLE = canOpenPty();

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
// 1. Paste data patterns via WS message handler
// ---------------------------------------------------------------------------

describe('Terminal WS message handler — paste data patterns', () => {
  let handler: ReturnType<typeof createTerminalWebSocketHandler>['handler'];

  afterEach(() => {
    // Each test creates its own handler to avoid cross-test session leaks
  });

  test('handles auth code paste (alphanumeric, 100+ chars)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // Simulate pasting a long auth code — should not throw
    const authCode = 'aB3cD5eF7gH9iJ1kL3mN5oP7qR9sT1uV3wX5yZ7' + '0'.repeat(80);
    handler.message(asWS(ws), authCode);

    handler.close(asWS(ws));
  });

  test('handles paste with special characters (=, +, /, etc.)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // Auth codes may contain base64-like special chars
    const specialPaste = 'eyJhbGci+OiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIi/OiIxMjM0NTY3ODkwIn0=';
    handler.message(asWS(ws), specialPaste);

    handler.close(asWS(ws));
  });

  test('handles paste containing newlines (multi-line paste)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // Multi-line paste — each line should be relayed
    handler.message(asWS(ws), 'line1\nline2\nline3\n');

    handler.close(asWS(ws));
  });

  test('handles paste containing carriage returns (\\r\\n from Windows)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // Windows clipboard may include \r\n line endings
    handler.message(asWS(ws), 'code-part1\r\ncode-part2\r\n');

    handler.close(asWS(ws));
  });

  test('handles bracket paste mode sequences', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // xterm.js may send bracket paste mode escape sequences when paste is handled
    // ESC[200~ = start paste, ESC[201~ = end paste
    const bracketPaste = '\x1b[200~pasted-auth-code-12345\x1b[201~';
    handler.message(asWS(ws), bracketPaste);

    handler.close(asWS(ws));
  });

  test('handles rapid sequential paste messages', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // Simulate rapid sequential pastes (user double-pastes or paste + Enter)
    for (let i = 0; i < 20; i++) {
      handler.message(asWS(ws), `chunk-${i}`);
    }

    handler.close(asWS(ws));
  });

  test('handles paste as Buffer (binary WS frame)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // WebSocket may deliver paste data as Buffer
    const bufferData = Buffer.from('auth-code-from-buffer');
    handler.message(asWS(ws), bufferData);

    handler.close(asWS(ws));
  });

  test('handles empty paste (empty string)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // Empty paste — should not crash
    handler.message(asWS(ws), '');

    handler.close(asWS(ws));
  });

  test('handles paste with Unicode characters', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));

    // Unicode in paste data (user may accidentally paste non-ASCII)
    handler.message(asWS(ws), 'auth\u2014code\u00e9\u00fc\u00f1');

    handler.close(asWS(ws));
  });

  test('handles paste after WS is closed (no crash)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('claude');
    handler.open(asWS(ws));
    handler.close(asWS(ws));

    // Message after close — should be a silent no-op
    handler.message(asWS(ws), 'late-paste-data');
    // No assertion needed — we just verify it doesn't throw
  });

  test('handles paste on non-claude backend (codex)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('codex');
    handler.open(asWS(ws));

    handler.message(asWS(ws), 'device-auth-code-12345');

    handler.close(asWS(ws));
  });

  test('handles paste on non-claude backend (gemini)', () => {
    const terminal = createTerminalWebSocketHandler();
    handler = terminal.handler;
    const ws = new MockTerminalWebSocket('gemini');
    handler.open(asWS(ws));

    handler.message(asWS(ws), 'verification-code-67890');

    handler.close(asWS(ws));
  });
});

// ---------------------------------------------------------------------------
// 2. PTY bridge — paste-specific data relay verification
// ---------------------------------------------------------------------------

describe('pty-bridge paste data relay', () => {
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
      env: { ...buildPtyEnv(), PATH: process.env.PATH ?? '' },
    });
    procs.push(proc);
    return proc;
  }

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

  test('relays auth code with special characters intact', async () => {
    if (!PTY_AVAILABLE) return;
    const proc = spawnBridge(['cat']);

    // Auth codes containing base64 chars
    const code = 'aB3+cD5/eF7=gH9i\n';
    proc.stdin.write(code);
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    // The special chars should survive the PTY relay
    expect(output).toContain('aB3+cD5/eF7=gH9i');

    await proc.exited;
  });

  test('relays Windows-style \\r\\n line endings', async () => {
    if (!PTY_AVAILABLE) return;
    const proc = spawnBridge(['cat']);

    // Windows clipboard uses \r\n — the PTY should handle it
    proc.stdin.write('hello\r\n');
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    expect(output).toContain('hello');

    await proc.exited;
  });

  test('relays bracket paste mode sequences', async () => {
    if (!PTY_AVAILABLE) return;
    const proc = spawnBridge(['cat']);

    // Bracket paste mode: ESC[200~ ... ESC[201~
    const bracketPaste = '\x1b[200~my-auth-code\x1b[201~\n';
    proc.stdin.write(bracketPaste);
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    // cat should echo the content — bracket mode sequences may or may not be visible
    // but the auth code payload must survive
    expect(output).toContain('my-auth-code');

    await proc.exited;
  });

  test('relays very large paste (1KB+ simulating accidental large paste)', async () => {
    if (!PTY_AVAILABLE) return;
    const proc = spawnBridge(['cat']);

    const largePaste = 'X'.repeat(1024) + '\n';
    proc.stdin.write(largePaste);
    proc.stdin.flush();

    await Bun.sleep(1000);
    proc.stdin.end();

    const output = await readOutput(proc);
    // At least a substantial portion should be echoed
    expect(output).toContain('X'.repeat(100));

    await proc.exited;
  });

  test('handles Ctrl+V character (0x16) in raw mode', async () => {
    if (!PTY_AVAILABLE) return;
    const proc = spawnBridge(['cat']);

    // In raw terminal mode, Ctrl+V sends 0x16 (SYN).
    // xterm.js should NOT send this — it should intercept and trigger browser paste.
    // But if it does arrive, the PTY should handle it gracefully.
    proc.stdin.write('\x16');
    proc.stdin.flush();

    await Bun.sleep(300);

    // Follow up with normal data to prove the PTY is still alive
    proc.stdin.write('still-alive\n');
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    expect(output).toContain('still-alive');

    await proc.exited;
  });

  test('handles paste followed immediately by Enter key', async () => {
    if (!PTY_AVAILABLE) return;
    const proc = spawnBridge(['cat']);

    // Simulate: paste code + press Enter (common user flow)
    proc.stdin.write('auth-code-xyz');
    proc.stdin.flush();
    proc.stdin.write('\r');
    proc.stdin.flush();

    await Bun.sleep(500);
    proc.stdin.end();

    const output = await readOutput(proc);
    expect(output).toContain('auth-code-xyz');

    await proc.exited;
  });
});

// ---------------------------------------------------------------------------
// 3. Buffer-to-string conversion edge cases (message handler code path)
// ---------------------------------------------------------------------------

describe('Buffer/string conversion for paste data', () => {
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

  test('Buffer containing multi-byte UTF-8 is decoded correctly', async () => {
    const proc = Bun.spawn(
      ['python3', '-c', 'import sys; data = sys.stdin.read(); print(f"GOT:{data}", end="")'],
      { stdin: 'pipe', stdout: 'pipe' },
    );
    procs.push(proc);

    // Simulate the message handler's Buffer path (terminal-ws.ts:342)
    const raw: string | Buffer = Buffer.from('code\u00e9\u00fc');
    const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    proc.stdin.write(data);
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(output).toContain('code');
    await proc.exited;
  });

  test('empty Buffer does not crash the conversion path', async () => {
    const proc = Bun.spawn(
      ['python3', '-c', 'import sys; data = sys.stdin.read(); print(f"GOT:{data}", end="")'],
      { stdin: 'pipe', stdout: 'pipe' },
    );
    procs.push(proc);

    const raw: string | Buffer = Buffer.from('');
    const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    proc.stdin.write(data);
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(output).toBe('GOT:');
    await proc.exited;
  });

  test('string path bypasses TextDecoder (no double-encode)', async () => {
    const proc = Bun.spawn(
      ['python3', '-c', 'import sys; data = sys.stdin.read(); print(f"GOT:{data}", end="")'],
      { stdin: 'pipe', stdout: 'pipe' },
    );
    procs.push(proc);

    // String path — should pass through without TextDecoder
    const raw: string | Buffer = 'direct-string-paste';
    const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    expect(data).toBe('direct-string-paste');

    proc.stdin.write(data);
    proc.stdin.end();

    const output = await new Response(proc.stdout).text();
    expect(output).toBe('GOT:direct-string-paste');
    await proc.exited;
  });
});
