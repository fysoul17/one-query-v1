import { AIBackend, BACKEND_CAPABILITIES, type StreamEvent } from '@autonomy/shared';
import { BackendError } from '../errors.ts';
import type { BackendProcess, BackendSpawnConfig, CLIBackend } from './types.ts';

/** Env vars allowlisted for child processes. Only forward what claude CLI needs. */
const ALLOWED_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'LANG',
  'NODE_ENV',
  'ANTHROPIC_API_KEY',
];

function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  // Also forward any CLAUDE_* env vars
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('CLAUDE_') && val !== undefined) {
      env[key] = val;
    }
  }
  return env;
}

class ClaudeProcess implements BackendProcess {
  private _alive = true;
  private _process: ReturnType<typeof Bun.spawn> | null = null;
  private config: BackendSpawnConfig;
  /** Tracks whether this session has been established (first send completed). */
  private sessionCreated = false;

  constructor(config: BackendSpawnConfig) {
    this.config = config;
  }

  get alive(): boolean {
    return this._alive;
  }

  async send(message: string): Promise<string> {
    if (!this._alive) {
      throw new BackendError('claude', 'Process is not alive');
    }

    const args = this.buildArgs(message);
    const env = buildSafeEnv();

    this._process = Bun.spawn(['claude', ...args], {
      cwd: this.config.cwd ?? process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdoutStream = this._process.stdout as ReadableStream;
    const stderrStream = this._process.stderr as ReadableStream;

    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(stdoutStream).text(),
      new Response(stderrStream).text(),
      this._process.exited,
    ]);

    this._process = null;

    if (exitCode !== 0) {
      throw new BackendError('claude', `Process exited with code ${exitCode}`);
    }

    return stdout.trim();
  }

  async *sendStreaming(message: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    if (!this._alive) {
      yield { type: 'error', error: 'Process is not alive' };
      return;
    }

    if (signal?.aborted) {
      yield { type: 'error', error: 'Aborted' };
      return;
    }

    const args = this.buildArgs(message);
    const env = buildSafeEnv();

    this._process = Bun.spawn(['claude', ...args], {
      cwd: this.config.cwd ?? process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const proc = this._process;
    const stdoutStream = proc.stdout as ReadableStream;
    const reader = stdoutStream.getReader();
    const decoder = new TextDecoder();

    // Abort handling: kill the process when signal fires
    const onAbort = () => {
      try {
        if (proc.exitCode === null) proc.kill();
      } catch {
        // Ignore kill errors
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (signal?.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (text) {
          yield { type: 'chunk', content: text };
        }
      }

      // Flush decoder
      const remaining = decoder.decode();
      if (remaining) {
        yield { type: 'chunk', content: remaining };
      }

      const exitCode = await proc.exited;
      this._process = null;

      if (exitCode !== 0) {
        yield { type: 'error', error: `Process exited with code ${exitCode}` };
      } else {
        yield { type: 'complete' };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: msg };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
  }

  async stop(): Promise<void> {
    if (this._process && this._process.exitCode === null) {
      this._process.kill();
      this._process = null;
    }
    this._alive = false;
  }

  private buildArgs(message: string): string[] {
    const args: string[] = ['-p', message];

    if (this.config.systemPrompt) {
      args.push('--system-prompt', this.config.systemPrompt);
    }
    if (this.config.tools && this.config.tools.length > 0) {
      args.push('--allowed-tools', ...this.config.tools);
    }
    if (this.config.skipPermissions !== false) {
      // Default: skip permissions (autonomous runtime in Docker sandbox)
      args.push('--dangerously-skip-permissions');
    }

    // Session persistence flags
    if (this.config.sessionPersistence === false) {
      args.push('--no-session-persistence');
    } else if (this.config.sessionId) {
      if (this.sessionCreated) {
        // Subsequent sends resume the existing session
        args.push('--resume', this.config.sessionId);
      } else {
        // First send creates the session
        args.push('--session-id', this.config.sessionId);
        this.sessionCreated = true;
      }
    }

    return args;
  }
}

export class ClaudeBackend implements CLIBackend {
  readonly name = AIBackend.CLAUDE;
  readonly capabilities = BACKEND_CAPABILITIES[AIBackend.CLAUDE];

  async spawn(config: BackendSpawnConfig): Promise<BackendProcess> {
    return new ClaudeProcess(config);
  }
}
