import {
  AIBackend,
  BACKEND_CAPABILITIES,
  type BackendConfigOption,
  type BackendStatus,
  Logger,
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

const codexLogger = new Logger({ context: { source: 'codex-backend' } });

class CodexProcess implements BackendProcess {
  private _alive = true;
  private _process: ReturnType<typeof Bun.spawn> | null = null;
  private config: BackendSpawnConfig;
  private _nativeSessionId: string | undefined;

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

    const chunks: string[] = [];
    for await (const event of this.sendStreaming(message)) {
      if (event.type === 'chunk' && event.content) {
        chunks.push(event.content);
      } else if (event.type === 'error') {
        throw new BackendError('codex', event.error ?? 'Unknown error');
      }
    }
    return chunks.join('');
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming parser requires sequential state handling
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

    const onAbort = () => {
      if (this._process && this._process.exitCode === null) {
        this._process.kill();
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      this._process = Bun.spawn(['codex', ...args], {
        cwd: this.config.cwd ?? process.cwd(),
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const reader = (
        this._process.stdout as ReadableStream<Uint8Array>
      ).getReader() as ReadableStreamDefaultReader<Uint8Array>;
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let hasContent = false;

      // Collect stderr in background
      const stderrPromise = new Response(this._process.stderr as ReadableStream).text();

      while (true) {
        if (signal?.aborted) {
          yield { type: 'error', error: 'Aborted' };
          reader.releaseLock();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });

        // Process complete NDJSON lines
        let newlineIdx: number = lineBuffer.indexOf('\n');
        while (newlineIdx !== -1) {
          const line = lineBuffer.slice(0, newlineIdx).trim();
          lineBuffer = lineBuffer.slice(newlineIdx + 1);
          if (!line) continue;

          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;

            // Capture session_id from any event that carries it
            if (typeof parsed.session_id === 'string' && parsed.session_id) {
              this._nativeSessionId = parsed.session_id;
            }

            // Map Codex NDJSON events to StreamEvent
            const events = this.parseCodexEvent(parsed);
            for (const event of events) {
              if (event.type === 'chunk') hasContent = true;
              yield event;
            }
          } catch {
            // Not valid JSON — emit as raw text chunk
            if (line) {
              hasContent = true;
              yield { type: 'chunk', content: line };
            }
          }
          newlineIdx = lineBuffer.indexOf('\n');
        }
      }

      // Process any remaining buffer
      const remaining = lineBuffer.trim();
      if (remaining) {
        try {
          const parsed = JSON.parse(remaining) as Record<string, unknown>;
          if (typeof parsed.session_id === 'string' && parsed.session_id) {
            this._nativeSessionId = parsed.session_id;
          }
          const events = this.parseCodexEvent(parsed);
          for (const event of events) {
            if (event.type === 'chunk') hasContent = true;
            yield event;
          }
        } catch {
          if (remaining) {
            hasContent = true;
            yield { type: 'chunk', content: remaining };
          }
        }
      }

      reader.releaseLock();

      const exitCode = await this._process.exited;
      const stderrText = await stderrPromise;
      this._process = null;

      if (exitCode !== 0) {
        const stderr = stderrText.trim().slice(0, 500);
        yield {
          type: 'error',
          error: stderr
            ? `Backend exited with code ${exitCode}: ${stderr}`
            : `Backend process exited with code ${exitCode}`,
        };
      } else if (!hasContent && stderrText.trim()) {
        yield {
          type: 'error',
          error: `Backend produced no output: ${stderrText.trim().slice(0, 500)}`,
        };
      } else {
        yield { type: 'complete' };
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async stop(): Promise<void> {
    if (this._process && this._process.exitCode === null) {
      this._process.kill();
      this._process = null;
    }
    this._alive = false;
  }

  /**
   * Map a Codex CLI --json NDJSON event to StreamEvents.
   *
   * Codex --json emits events like:
   *   {type: "message", role: "assistant", content: "..."} — assistant text
   *   {type: "function_call", name: "...", arguments: "..."} — tool call
   *   {type: "function_call_output", output: "..."} — tool result
   *   {session_id: "...", ...} — session metadata
   *
   * Simpler events may just have text content directly.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser handles many event types
  private parseCodexEvent(parsed: Record<string, unknown>): StreamEvent[] {
    const events: StreamEvent[] = [];
    const eventType = parsed.type as string | undefined;

    if (eventType === 'message' || eventType === 'assistant') {
      const content = parsed.content as string | undefined;
      if (content) {
        events.push({ type: 'chunk', content });
      }
    } else if (eventType === 'function_call') {
      const name = parsed.name as string | undefined;
      const id = (parsed.id as string) || `tool-${Date.now()}`;
      if (name) {
        events.push({ type: 'tool_start', toolId: id, toolName: name });
        const args = parsed.arguments as string | undefined;
        if (args) {
          events.push({ type: 'tool_input', toolId: id, toolName: name, inputDelta: args });
        }
      }
    } else if (eventType === 'function_call_output') {
      // Tool results — informational, no action needed
      codexLogger.debug('Codex tool output', { output: parsed.output });
    } else if (typeof parsed.content === 'string' && parsed.content) {
      // Generic content field
      events.push({ type: 'chunk', content: parsed.content });
    } else if (typeof parsed.message === 'string' && parsed.message) {
      // Some events use 'message' field
      events.push({ type: 'chunk', content: parsed.message });
    }

    return events;
  }

  private buildArgs(message: string): string[] {
    // Session resume: subsequent calls use `exec resume <sessionId> <message>`
    if (this._nativeSessionId) {
      return ['exec', 'resume', this._nativeSessionId, '--json', '--full-auto', message];
    }

    // First call: `exec <message>` with --json for NDJSON streaming
    const args: string[] = ['exec', '--json', '--full-auto', '--skip-git-repo-check'];

    if (this.config.systemPrompt) {
      args.push('-c', `developer_instructions=${this.config.systemPrompt}`);
    }

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    if (this.config.extraFlags) {
      for (const [flag, value] of Object.entries(this.config.extraFlags)) {
        args.push(flag, value);
      }
    }

    args.push(message);
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
