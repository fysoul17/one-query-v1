/**
 * WebSocket-based PTY terminal for interactive CLI sessions.
 *
 * Uses a Python PTY bridge (pty-bridge.py) to give spawned commands a real
 * pseudo-terminal, then relays I/O over WebSocket to an xterm.js frontend.
 *
 * Protocol:
 *   Client -> Server:  raw keystrokes (binary or text)
 *   Server -> Client:  raw terminal output (binary or text)
 */
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';

export interface TerminalWSData {
  id: string;
  type: 'terminal';
  /** Which backend this terminal session is for. */
  backend: string;
}

/**
 * Per-backend login commands.
 * Each entry maps a backend name to the CLI args passed to the PTY bridge.
 * This is the ONLY place that determines what commands can be spawned —
 * arbitrary backend names are rejected.
 *
 * Claude uses the REPL with auto-injected `/login` command. This stores
 * the OAuth token in Claude's config file (persistent across restarts),
 * unlike `setup-token` which only prints the token for env var usage.
 */
export const LOGIN_COMMANDS: Record<string, string[]> = {
  claude: ['claude'],
  codex: ['codex', 'login', '--device-auth'],
  gemini: ['gemini', 'auth', 'login'],
  pi: ['pi', 'auth', 'login'],
};

/** Delay (ms) before auto-injecting `/login` into the Claude REPL. */
const CLAUDE_LOGIN_INJECT_DELAY_MS = 2000;

/**
 * Env vars allowlisted for the PTY login process.
 *
 * Only forward what the CLI needs to function and open the browser for OAuth.
 * Server-side secrets (ANTHROPIC_API_KEY, AUTH_MASTER_KEY, etc.) are excluded.
 */
const PTY_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'DISPLAY',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'SSH_AUTH_SOCK',
  'CODEX_HOME',
  'GEMINI_CLI_HOME',
];

export function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PTY_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  // Forward CLAUDE_* env vars (config, not secrets) but exclude CLAUDECODE
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') && key !== 'CLAUDECODE' && val !== undefined) {
      env[key] = val;
    }
  }
  // Ensure proper terminal type for xterm.js rendering
  env.TERM = 'xterm-256color';
  // Suppress browser auto-open — the dashboard shows auth URLs as clickable links
  env.BROWSER = '';
  // Gemini-specific: force headless paste-code flow
  env.NO_BROWSER = 'true';
  return env;
}

interface PtySession {
  proc: ReturnType<typeof Bun.spawn>;
  alive: boolean;
  /** Whether gracefullyExitRepl has been called (prevents double-invocation). */
  exiting?: boolean;
  /** Timer for polling auth status (Claude backend). */
  authPollTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, PtySession>();

/** 5-minute hard timeout for login PTY sessions. */
const PTY_TIMEOUT_MS = 5 * 60 * 1000;

const PTY_BRIDGE_PATH = join(import.meta.dir, 'pty-bridge.py');

/** Pipe a ReadableStream to a WebSocket, stopping when the session dies. */
async function pipeStreamToWs(
  stream: ReadableStream<Uint8Array>,
  ws: ServerWebSocket<TerminalWSData>,
  session: PtySession,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (session.alive) {
      const { done, value } = await reader.read();
      if (done) break;
      try {
        ws.send(value);
      } catch {
        break; // WebSocket closed
      }
    }
  } catch {
    // Stream error
  } finally {
    reader.releaseLock();
  }
}

/** Send an ANSI-formatted message to a WebSocket, ignoring errors. */
function sendAnsiMessage(ws: ServerWebSocket<TerminalWSData>, msg: string): void {
  try {
    ws.send(new TextEncoder().encode(msg));
  } catch {
    // Already closed
  }
}

/** Clean up a PTY session after the process exits. */
async function handleProcessExit(
  proc: ReturnType<typeof Bun.spawn>,
  ws: ServerWebSocket<TerminalWSData>,
  session: PtySession,
  sessionId: string,
): Promise<void> {
  try {
    const exitCode = await proc.exited;
    sendAnsiMessage(ws, `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
  } catch {
    // Ignore
  }
  session.alive = false;
  sessions.delete(sessionId);
  try {
    ws.close();
  } catch {
    // Already closed
  }
}

/** Interval (ms) between auth status polls for auto-close detection. */
const AUTH_POLL_INTERVAL_MS = 3000;

/** Grace period (ms) after sending /exit before force-killing the REPL. */
const REPL_EXIT_GRACE_MS = 1500;

/**
 * Gracefully exit the Claude REPL: send `/exit`, then force-kill after grace period.
 * The REPL's natural exit triggers handleProcessExit → ws.close() → frontend success.
 */
function gracefullyExitRepl(session: PtySession, sessionId: string): void {
  if (!session.alive || session.exiting) return;
  session.exiting = true;

  // Stop polling
  if (session.authPollTimer) {
    clearTimeout(session.authPollTimer);
    session.authPollTimer = undefined;
  }

  try {
    session.proc.stdin.write('/exit\r');
    session.proc.stdin.flush();
  } catch {
    // stdin already closed
  }

  // Safety net: force-kill if /exit doesn't cause the process to exit in time
  setTimeout(() => {
    if (!session.alive) return;
    session.alive = false;
    try {
      session.proc.kill();
    } catch {
      // Already exited
    }
    sessions.delete(sessionId);
  }, REPL_EXIT_GRACE_MS);
}

/**
 * Poll `claude auth status --json` to detect login completion.
 * Once loggedIn flips to true, auto-exit the REPL so the terminal closes cleanly.
 *
 * Uses self-scheduling setTimeout (not setInterval) to prevent overlapping polls
 * when the auth status command takes longer than the poll interval.
 */
function startAuthStatusPoll(
  ws: ServerWebSocket<TerminalWSData>,
  session: PtySession,
  sessionId: string,
  env: Record<string, string>,
): void {
  async function poll() {
    if (!session.alive) return;
    try {
      const proc = Bun.spawn(['claude', 'auth', 'status', '--json'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      const status = JSON.parse(text);
      if (status.loggedIn === true || status.authenticated === true) {
        sendAnsiMessage(ws, '\r\n\x1b[32m✓ Login detected — closing terminal…\x1b[0m\r\n');
        gracefullyExitRepl(session, sessionId);
        return;
      }
    } catch {
      // Ignore poll errors (CLI not found, JSON parse failure, etc.)
    }
    // Schedule next poll only after the current one completes
    if (session.alive) {
      session.authPollTimer = setTimeout(poll, AUTH_POLL_INTERVAL_MS);
    }
  }
  session.authPollTimer = setTimeout(poll, AUTH_POLL_INTERVAL_MS);
}

/** Set a hard timeout that kills the PTY session after PTY_TIMEOUT_MS. */
function setupPtyTimeout(
  ws: ServerWebSocket<TerminalWSData>,
  session: PtySession,
  sessionId: string,
): void {
  setTimeout(() => {
    if (!session.alive) return;
    session.alive = false;
    if (session.authPollTimer) {
      clearTimeout(session.authPollTimer);
      session.authPollTimer = undefined;
    }
    try {
      session.proc.kill();
    } catch {
      // Ignore
    }
    sendAnsiMessage(ws, '\r\n\x1b[31m[Login timed out]\x1b[0m\r\n');
    try {
      ws.close();
    } catch {
      // Already closed
    }
    sessions.delete(sessionId);
  }, PTY_TIMEOUT_MS);
}

export function createTerminalWebSocketHandler() {
  return {
    handler: {
      open(ws: ServerWebSocket<TerminalWSData>) {
        const { backend, id: sessionId } = ws.data;
        const loginCmd = LOGIN_COMMANDS[backend];

        if (!loginCmd) {
          sendAnsiMessage(ws, `\x1b[31mUnknown backend: ${backend}\x1b[0m\r\n`);
          try {
            ws.close();
          } catch {
            // Already closed
          }
          return;
        }

        const env = buildPtyEnv();
        const proc = Bun.spawn(['python3', PTY_BRIDGE_PATH, ...loginCmd], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          env,
        });

        const session: PtySession = { proc, alive: true };
        sessions.set(sessionId, session);

        // Pipe stdout to WS, then handle exit notification
        pipeStreamToWs(proc.stdout as ReadableStream<Uint8Array>, ws, session).then(() =>
          handleProcessExit(proc, ws, session, sessionId),
        );

        // Pipe stderr to WS
        pipeStreamToWs(proc.stderr as ReadableStream<Uint8Array>, ws, session);

        // Hard timeout
        setupPtyTimeout(ws, session, sessionId);

        // Auto-inject /login command into the Claude REPL after it initializes,
        // then poll auth status to auto-close when login completes.
        if (backend === 'claude') {
          setTimeout(() => {
            if (!session.alive) return;
            try {
              session.proc.stdin.write('/login\r');
              session.proc.stdin.flush();
            } catch {
              // stdin closed
            }
            // Start polling auth status after /login is injected
            startAuthStatusPoll(ws, session, sessionId, env);
          }, CLAUDE_LOGIN_INJECT_DELAY_MS);
        }
      },

      message(ws: ServerWebSocket<TerminalWSData>, raw: string | Buffer) {
        const session = sessions.get(ws.data.id);
        if (!session?.alive) return;

        try {
          const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
          session.proc.stdin.write(data);
          session.proc.stdin.flush();
        } catch {
          // stdin closed
        }
      },

      close(ws: ServerWebSocket<TerminalWSData>) {
        const session = sessions.get(ws.data.id);
        if (!session) return;

        const { backend, id: sessionId } = ws.data;

        // Stop auth polling if active
        if (session.authPollTimer) {
          clearTimeout(session.authPollTimer);
          session.authPollTimer = undefined;
        }

        // For the Claude REPL, send /exit first so it can flush config writes
        // (e.g. OAuth token saved by /login), then force-kill after a grace period.
        if (backend === 'claude') {
          gracefullyExitRepl(session, sessionId);
        } else {
          session.alive = false;
          sessions.delete(sessionId);
          try {
            session.proc.kill();
          } catch {
            // Ignore
          }
        }

        try {
          session.proc.stdin.end();
        } catch {
          // Ignore
        }
      },
    },
  };
}
