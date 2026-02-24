import {
  AIBackend,
  BACKEND_CAPABILITIES,
  type BackendConfigOption,
  type BackendStatus,
  type StreamEvent,
} from '@autonomy/shared';
import { BackendError } from '../errors.ts';
import type { BackendProcess, BackendSpawnConfig, CLIBackend } from './types.ts';

function maskApiKey(key: string | undefined): string | undefined {
  if (!key || key.length < 12) return undefined;
  return `sk-...${key.slice(-4)}`;
}

/** Env vars allowlisted for Codex child processes. */
const ALLOWED_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_ENV',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_HOME',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'DISPLAY',
];

function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  // Codex uses OPENAI_API_KEY; map CODEX_API_KEY if OPENAI_API_KEY isn't set
  if (!env.OPENAI_API_KEY && env.CODEX_API_KEY) {
    env.OPENAI_API_KEY = env.CODEX_API_KEY;
  }
  return env;
}

class CodexProcess implements BackendProcess {
  private _alive = true;
  private _process: ReturnType<typeof Bun.spawn> | null = null;
  private config: BackendSpawnConfig;
  private _nativeSessionId: string | undefined;
  private _firstCallDone = false;

  constructor(config: BackendSpawnConfig) {
    this.config = config;
  }

  get alive(): boolean {
    return this._alive;
  }

  get nativeSessionId(): string | undefined {
    return this._nativeSessionId;
  }

  async send(message: string): Promise<string> {
    if (!this._alive) {
      throw new BackendError('codex', 'Process is not alive');
    }

    const args = this.buildArgs(message);
    const env = buildSafeEnv();

    this._process = Bun.spawn(['codex', ...args], {
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
      throw new BackendError('codex', `Process exited with code ${exitCode}`);
    }

    this._firstCallDone = true;

    // Try to parse session_id from JSON output
    const trimmed = stdout.trim();
    try {
      const parsed = JSON.parse(trimmed) as { session_id?: string };
      if (parsed.session_id) {
        this._nativeSessionId = parsed.session_id;
      }
    } catch {
      // Not JSON — that's fine, return as plain text
    }

    return trimmed;
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

    try {
      const result = await this.send(message);
      if (result) {
        yield { type: 'chunk', content: result };
      }
      yield { type: 'complete' };
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
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
    // Session resume: subsequent calls use `exec resume <sessionId> <message>`
    if (this._nativeSessionId) {
      return ['exec', 'resume', this._nativeSessionId, message];
    }

    // First call: `exec <message>` with config flags
    const args: string[] = ['exec', message];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    if (this.config.extraFlags) {
      for (const [flag, value] of Object.entries(this.config.extraFlags)) {
        args.push(flag, value);
      }
    }

    return args;
  }
}

export class CodexBackend implements CLIBackend {
  readonly name = AIBackend.CODEX;
  readonly capabilities = BACKEND_CAPABILITIES[AIBackend.CODEX];

  getConfigOptions(): BackendConfigOption[] {
    return [
      {
        name: 'model',
        cliFlag: '--model',
        description: 'Model name (e.g., o4-mini, o3)',
        values: ['o4-mini', 'o3', 'gpt-4.1'],
        defaultValue: 'o4-mini',
      },
    ];
  }

  async spawn(config: BackendSpawnConfig): Promise<BackendProcess> {
    return new CodexProcess(config);
  }

  async logout(): Promise<void> {
    const env = buildSafeEnv();
    const proc = Bun.spawn(['codex', 'logout'], {
      cwd: process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr as ReadableStream).text();
      throw new BackendError('codex', `Logout failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  /**
   * Check CLI login state by running `codex login status`.
   * Exit code 0 means logged in; non-zero means not authenticated.
   */
  private async checkCliAuth(): Promise<boolean> {
    const env = buildSafeEnv();
    try {
      const proc = Bun.spawn(['codex', 'login', 'status'], {
        cwd: process.cwd(),
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((resolve) => {
          timeoutHandle = setTimeout(() => {
            try {
              proc.kill();
            } catch {
              // ignore kill errors
            }
            resolve(1);
          }, 5000);
        }),
      ]);
      clearTimeout(timeoutHandle);

      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<BackendStatus> {
    const cliPath = typeof Bun !== 'undefined' ? Bun.which('codex') : null;
    const available = cliPath !== null;

    const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
    const hasApiKey = !!apiKey;

    // Check actual CLI authentication only when CLI is available and no API key is set
    const cliAuthenticated = available && !hasApiKey ? await this.checkCliAuth() : false;

    let authMode: BackendStatus['authMode'] = 'none';
    if (hasApiKey) {
      authMode = 'api_key';
    } else if (cliAuthenticated) {
      authMode = 'cli_login';
    }

    const authenticated = hasApiKey || cliAuthenticated;
    const configured = authenticated;

    return {
      name: this.name,
      available,
      configured,
      authenticated,
      apiKeyMasked: maskApiKey(apiKey),
      authMode,
      capabilities: this.capabilities,
      error: available ? undefined : 'codex CLI not found on PATH',
    };
  }
}
