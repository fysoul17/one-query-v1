import {
  AIBackend,
  BACKEND_CAPABILITIES,
  type BackendConfigOption,
  type BackendStatus,
  getErrorDetail,
  Logger,
  type StreamEvent,
} from '@autonomy/shared';
import { BackendError } from '../errors.ts';
import { finalizeProcess, readNDJSONStream } from './ndjson-stream.ts';
import {
  buildSafeEnv as buildSafeEnvBase,
  checkCliAuth,
  getCliBackendStatus,
} from './shared-utils.ts';
import type { BackendProcess, BackendSpawnConfig, CLIBackend } from './types.ts';

/** Env vars allowlisted for Gemini child processes. */
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
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_CLI_HOME',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'DISPLAY',
] as const;

function buildSafeEnv(): Record<string, string> {
  return buildSafeEnvBase(ALLOWED_ENV_KEYS, { GEMINI_API_KEY: 'GOOGLE_API_KEY' });
}

const geminiLogger = new Logger({ context: { source: 'gemini-backend' } });

class GeminiProcess implements BackendProcess {
  private _alive = true;
  private _process: ReturnType<typeof Bun.spawn> | null = null;
  private config: BackendSpawnConfig;
  private _nativeSessionId: string | undefined;

  constructor(config: BackendSpawnConfig) {
    this.config = config;
    // Restore native session ID for resume across restarts.
    // No _firstCallDone flag needed — Gemini uses _nativeSessionId directly in buildArgs.
    if (config.sessionId) {
      this._nativeSessionId = config.sessionId;
    }
  }

  get alive(): boolean {
    return this._alive;
  }

  get nativeSessionId(): string | undefined {
    return this._nativeSessionId;
  }

  async send(message: string): Promise<string> {
    if (!this._alive) {
      throw new BackendError('gemini', 'Process is not alive');
    }

    const chunks: string[] = [];
    for await (const event of this.sendStreaming(message)) {
      if (event.type === 'chunk' && event.content) {
        chunks.push(event.content);
      } else if (event.type === 'error') {
        throw new BackendError('gemini', event.error ?? 'Unknown error');
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

    // Gemini uses GEMINI_SYSTEM_MD env var for system prompt
    if (this.config.systemPrompt && !this._nativeSessionId) {
      const tmpDir = process.env.TMPDIR || '/tmp';
      const promptFile = `${tmpDir}/gemini-prompt-${this.config.agentId}.md`;
      await Bun.write(promptFile, this.config.systemPrompt);
      env.GEMINI_SYSTEM_MD = promptFile;
    }

    const onAbort = () => {
      if (this._process && this._process.exitCode === null) {
        this._process.kill();
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      this._process = Bun.spawn(['gemini', ...args], {
        cwd: this.config.cwd ?? process.cwd(),
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const reader = (this._process.stdout as ReadableStream<Uint8Array>).getReader();
      let hasContent = false;
      let streamDone = false;

      // Collect stderr in background
      const stderrPromise = new Response(this._process.stderr as ReadableStream).text();

      for await (const line of readNDJSONStream(reader)) {
        if (signal?.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        if (line.type === 'json') {
          if (typeof line.data.session_id === 'string' && line.data.session_id) {
            this._nativeSessionId = line.data.session_id;
          }
          const events = this.parseGeminiEvent(line.data);
          for (const event of events) {
            if (event.type === 'chunk') hasContent = true;
            if (event.type === 'complete' || event.type === 'error') streamDone = true;
            yield event;
          }
          if (streamDone) break;
        } else {
          hasContent = true;
          yield { type: 'chunk', content: line.data };
        }
      }

      const exitCode = await this._process.exited;
      const stderrText = await stderrPromise;
      this._process = null;

      if (!streamDone) {
        yield* finalizeProcess(exitCode, stderrText, hasContent);
      }
    } catch (error) {
      yield { type: 'error', error: getErrorDetail(error) };
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

    // Clean up temp system prompt file
    const tmpDir = process.env.TMPDIR || '/tmp';
    const promptFile = `${tmpDir}/gemini-prompt-${this.config.agentId}.md`;
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(promptFile);
    } catch {
      // File may not exist if sendStreaming was never called
    }
  }

  /**
   * Map a Gemini CLI stream-json event to StreamEvents.
   *
   * Gemini --output-format stream-json emits NDJSON events:
   *   {type:"init", session_id:"...", model:"...", timestamp:"..."}
   *   {type:"message", role:"user"|"assistant", content:"..."}
   *   {type:"tool_use", tool_name:"...", parameters:{...}}
   *   {type:"tool_result", tool_id:"...", status:"success"|"error", output:"..."}
   *   {type:"error", message:"..."}
   *   {type:"result", status:"success"|"error", stats:{...}}
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser handles many event types
  private parseGeminiEvent(parsed: Record<string, unknown>): StreamEvent[] {
    const events: StreamEvent[] = [];
    const eventType = parsed.type as string | undefined;

    switch (eventType) {
      case 'init':
        // Session start — just capture session_id (already done above)
        geminiLogger.debug('Gemini session init', {
          sessionId: parsed.session_id,
          model: parsed.model,
        });
        break;

      case 'message': {
        const role = parsed.role as string | undefined;
        const content = parsed.content as string | undefined;
        if (role === 'assistant' && content) {
          events.push({ type: 'chunk', content });
        }
        break;
      }

      case 'tool_use': {
        const toolName = parsed.tool_name as string | undefined;
        const toolId = (parsed.tool_id as string) || `tool-${Date.now()}`;
        if (toolName) {
          events.push({ type: 'tool_start', toolId, toolName });
          const params = parsed.parameters;
          if (params && typeof params === 'object' && Object.keys(params).length > 0) {
            events.push({
              type: 'tool_input',
              toolId,
              toolName,
              inputDelta: JSON.stringify(params, null, 2),
            });
          }
        }
        break;
      }

      case 'tool_result': {
        const toolId = parsed.tool_id as string | undefined;
        if (toolId) {
          events.push({ type: 'tool_complete', toolId });
        }
        break;
      }

      case 'error': {
        const message = (parsed.message as string) || 'Unknown Gemini error';
        events.push({ type: 'error', error: message });
        break;
      }

      case 'result': {
        const status = parsed.status as string | undefined;
        if (status === 'error') {
          const errMsg = (parsed.error as { message?: string })?.message || 'Gemini session failed';
          events.push({ type: 'error', error: errMsg });
        } else {
          events.push({ type: 'complete' });
        }
        break;
      }

      default:
        // Unknown event type — check for generic content
        if (typeof parsed.content === 'string' && parsed.content) {
          events.push({ type: 'chunk', content: parsed.content });
        }
        break;
    }

    return events;
  }

  private buildArgs(message: string): string[] {
    // Always include stream-json output and auto-approval
    const baseFlags = ['--output-format', 'stream-json', '--approval-mode=yolo'];

    // Session resume: subsequent calls use `--resume <sessionId> -p <message>`
    if (this._nativeSessionId) {
      return [...baseFlags, '--resume', this._nativeSessionId, '-p', message];
    }

    // First call: include full config flags
    const args: string[] = [...baseFlags, '-p', message];

    if (this.config.tools && this.config.tools.length > 0) {
      args.push('--allowed-tools', ...this.config.tools);
    }

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

export class GeminiBackend implements CLIBackend {
  readonly name = AIBackend.GEMINI;
  readonly capabilities = BACKEND_CAPABILITIES[AIBackend.GEMINI];

  getConfigOptions(): BackendConfigOption[] {
    return [
      {
        name: 'model',
        cliFlag: '--model',
        description: 'Model name (e.g., gemini-2.5-pro, gemini-2.5-flash)',
        values: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        defaultValue: 'gemini-2.5-flash',
      },
    ];
  }

  async spawn(config: BackendSpawnConfig): Promise<BackendProcess> {
    return new GeminiProcess(config);
  }

  async logout(): Promise<void> {
    const env = buildSafeEnv();
    const proc = Bun.spawn(['gemini', 'auth', 'logout'], {
      cwd: process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr as ReadableStream).text();
      throw new BackendError('gemini', `Logout failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  async getStatus(): Promise<BackendStatus> {
    return getCliBackendStatus({
      name: this.name,
      cliBinary: 'gemini',
      apiKeyEnvVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      capabilities: this.capabilities,
      checkAuth: () => checkCliAuth(['gemini', 'auth', 'status'], buildSafeEnv()),
    });
  }
}
