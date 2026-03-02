import {
  AIBackend,
  BACKEND_CAPABILITIES,
  type BackendConfigOption,
  type BackendStatus,
  DEFAULTS,
  getErrorDetail,
  Logger,
  type StreamEvent,
} from '@autonomy/shared';
import { BackendError } from '../errors.ts';
import {
  buildSafeEnv as buildSafeEnvBase,
  checkCliAuth,
  getCliBackendStatus,
} from './shared-utils.ts';
import type { BackendProcess, BackendSpawnConfig, CLIBackend } from './types.ts';

const claudeLogger = new Logger({ context: { source: 'claude-backend' } });

/** Max bytes to read from stderr to prevent unbounded memory usage. */
const MAX_STDERR_BYTES = 4096;

/** Read stderr with a size cap. Returns at most MAX_STDERR_BYTES of text. */
async function readBoundedStderr(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (totalBytes < MAX_STDERR_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder()
    .decode(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks))
    .slice(0, MAX_STDERR_BYTES);
}

/** Env vars allowlisted for child processes. Only forward what claude CLI needs. */
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
  'ANTHROPIC_API_KEY',
  // XDG dirs — needed for CLI to find auth credentials on Linux
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  // macOS-specific
  'DISPLAY',
] as const;

function buildSafeEnv(): Record<string, string> {
  return buildSafeEnvBase(ALLOWED_ENV_KEYS, undefined, (env) => {
    // Forward CLAUDE_* env vars but exclude vars that block nested sessions
    for (const [key, val] of Object.entries(process.env)) {
      if (key.startsWith('CLAUDE_') && val !== undefined) {
        env[key] = val;
      }
    }
    // Never forward CLAUDECODE — it prevents the CLI from launching as a child process
    delete env.CLAUDECODE;
  });
}

class ClaudeProcess implements BackendProcess {
  private _alive = true;
  private _process: ReturnType<typeof Bun.spawn> | null = null;
  private config: BackendSpawnConfig;
  private _nativeSessionId: string | undefined;
  private _firstCallDone = false;

  constructor(config: BackendSpawnConfig) {
    this.config = config;
    // Restore native session from a previously persisted ID so --resume works
    // across process restarts (e.g., Docker rebuild, LRU eviction).
    if (config.sessionId) {
      this._nativeSessionId = config.sessionId;
      this._firstCallDone = true;
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

    // Parse JSON output to extract session_id and result text.
    // Only mark _firstCallDone when session_id is captured — otherwise subsequent
    // calls would lose --system-prompt and config flags without gaining --resume.
    const trimmed = stdout.trim();
    try {
      const parsed = JSON.parse(trimmed) as {
        session_id?: string;
        result?: string;
      };
      if (parsed.session_id) {
        this._nativeSessionId = parsed.session_id;
        this._firstCallDone = true;
        claudeLogger.debug('Captured native session ID', { sessionId: parsed.session_id });
      }
      return (typeof parsed.result === 'string' ? parsed.result : trimmed).trim();
    } catch {
      // Fallback: if output isn't JSON, return as plain text
      return trimmed;
    }
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

    const args = this.buildStreamingArgs(message);
    const env = buildSafeEnv();

    this._process = Bun.spawn(['claude', ...args], {
      cwd: this.config.cwd ?? process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const proc = this._process;
    const stdoutStream = proc.stdout as ReadableStream;
    const stderrStream = proc.stderr as ReadableStream;
    const reader = stdoutStream.getReader();
    const decoder = new TextDecoder();

    // Read stderr in background (bounded to prevent memory issues)
    const stderrPromise = readBoundedStderr(stderrStream);

    // Abort handling: kill the process when signal fires
    const onAbort = () => {
      try {
        if (proc.exitCode === null) proc.kill();
      } catch {
        // Ignore kill errors
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let hasContent = false;
    // Set to true when the CLI 'result' event is processed — prevents double-yielding
    // complete/error from the exit-code fallback below.
    let streamDone = false;

    // State for Claude Code SDK stream-json format (assistant/user/result events).
    // text/thinking deltas are tracked by content block index; tool lifecycle by toolId.
    const textProgress = new Map<number, number>();
    const thinkingProgress = new Map<number, number>();
    const activeTools = new Map<string, { name: string; startMs: number }>();

    let lineBuffer = '';
    // If the first line fails JSON parsing, fall back to raw text mode for the rest of the stream
    let rawTextMode = false;

    try {
      while (true) {
        if (signal?.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (!text) continue;

        // Raw text fallback mode — yield as plain chunks (same as before stream-json)
        if (rawTextMode) {
          hasContent = true;
          yield { type: 'chunk', content: text };
          continue;
        }

        // NDJSON parsing — split on newlines and process each JSON line
        lineBuffer += text;
        const lines = lineBuffer.split('\n');
        // Last element may be incomplete — keep it in the buffer
        lineBuffer = lines.pop() ?? '';

        for (let li = 0; li < lines.length; li++) {
          const trimmed = (lines[li] ?? '').trim();
          if (!trimmed) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            // First non-JSON line switches to raw text mode (e.g., older CLI without stream-json)
            if (!hasContent) {
              rawTextMode = true;
              claudeLogger.debug('stream-json parse failed, falling back to raw text mode');
              hasContent = true;
              yield { type: 'chunk', content: trimmed };
              const remaining = lines.slice(li + 1).join('\n');
              if (remaining) yield { type: 'chunk', content: remaining };
              break;
            }
            // After content has started, skip unparseable lines
            continue;
          }

          const events = this.parseStreamJsonEvent(
            parsed,
            textProgress,
            thinkingProgress,
            activeTools,
          );
          for (const event of events) {
            if (event.type === 'chunk') hasContent = true;
            if (event.type === 'complete' || event.type === 'error') streamDone = true;
            yield event;
          }
          if (streamDone) break;
        }
        if (streamDone) break;
      }

      // Flush decoder — may produce final bytes if stream ended mid-multibyte-sequence
      const decoderRemainder = decoder.decode();
      if (decoderRemainder) lineBuffer += decoderRemainder;

      // Process any buffered content that didn't end with a newline (common when stream
      // ends without a trailing '\n', e.g. raw text or single-line output from mocks).
      if (!streamDone && lineBuffer.trim()) {
        const trimmed = lineBuffer.trim();
        lineBuffer = '';
        if (rawTextMode) {
          hasContent = true;
          yield { type: 'chunk', content: trimmed };
        } else {
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            const events = this.parseStreamJsonEvent(
              parsed,
              textProgress,
              thinkingProgress,
              activeTools,
            );
            for (const event of events) {
              if (event.type === 'chunk') hasContent = true;
              if (event.type === 'complete' || event.type === 'error') streamDone = true;
              yield event;
            }
          } catch {
            if (!hasContent) {
              hasContent = true;
              yield { type: 'chunk', content: trimmed };
            }
          }
        }
      }

      const exitCode = await proc.exited;
      const stderrText = await stderrPromise;
      this._process = null;

      // streamDone means the 'result' event already yielded complete/error — don't double-emit.
      if (!streamDone) {
        if (exitCode !== 0) {
          const stderr = stderrText.trim().slice(0, DEFAULTS.MAX_ERROR_PREVIEW_LENGTH);
          claudeLogger.warn('Backend process failed', { exitCode, stderr });
          // Include stderr summary in error so it reaches debug console via DebugBus.
          // The websocket layer sanitizes what the chat client sees.
          yield {
            type: 'error',
            error: stderr
              ? `Backend exited with code ${exitCode}: ${stderr}`
              : `Backend process exited with code ${exitCode}`,
          };
        } else if (!hasContent && stderrText.trim()) {
          const stderr = stderrText.trim().slice(0, DEFAULTS.MAX_ERROR_PREVIEW_LENGTH);
          claudeLogger.warn('Backend produced no output', { stderr });
          yield {
            type: 'error',
            error: `Backend produced no output: ${stderr}`,
          };
        } else {
          yield { type: 'complete' };
        }
      }
    } catch (error) {
      yield { type: 'error', error: getErrorDetail(error) };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
  }

  /**
   * Map a single Claude CLI stream-json event to zero or more StreamEvents.
   *
   * The Claude Code CLI `--output-format stream-json --verbose` emits the higher-level
   * Claude Code SDK message format — NOT the raw Anthropic streaming SSE events.
   *
   * Event types emitted by the CLI:
   *   {type:"system", subtype:"init", ...}              — init, ignored
   *   {type:"assistant", message:{content:[...]}, ...}  — model response (may arrive multiple
   *                                                        times with growing content)
   *   {type:"user", message:{content:[...]}, ...}       — tool results fed back to model
   *   {type:"result", subtype:"success|error_*", ...}   — final result → complete or error
   *
   * Text/thinking content grows across consecutive "assistant" events; we track progress
   * per block index so only the delta is emitted each time.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser handles many event types
  private parseStreamJsonEvent(
    parsed: Record<string, unknown>,
    textProgress: Map<number, number>,
    thinkingProgress: Map<number, number>,
    activeTools: Map<string, { name: string; startMs: number }>,
  ): StreamEvent[] {
    const eventType = parsed.type as string | undefined;
    if (!eventType) return [];

    switch (eventType) {
      case 'assistant': {
        const content = (parsed.message as { content?: unknown[] } | undefined)?.content;
        if (!Array.isArray(content)) return [];

        const events: StreamEvent[] = [];
        for (let i = 0; i < content.length; i++) {
          const b = content[i] as Record<string, unknown>;
          if (!b || typeof b !== 'object') continue;

          if (b.type === 'text' && typeof b.text === 'string') {
            // Emit only the new portion since last event (content accumulates across events).
            const prev = textProgress.get(i) ?? 0;
            const delta = b.text.slice(prev);
            if (delta) {
              textProgress.set(i, b.text.length);
              events.push({ type: 'chunk', content: delta });
            }
          } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
            const prev = thinkingProgress.get(i) ?? 0;
            const delta = b.thinking.slice(prev);
            if (delta) {
              thinkingProgress.set(i, b.thinking.length);
              events.push({ type: 'thinking', content: delta });
            }
          } else if (
            b.type === 'tool_use' &&
            typeof b.id === 'string' &&
            typeof b.name === 'string'
          ) {
            // Only emit once — the block appears in full when the CLI has the complete call.
            if (!activeTools.has(b.id)) {
              activeTools.set(b.id, { name: b.name, startMs: Date.now() });
              events.push({ type: 'tool_start', toolId: b.id, toolName: b.name });
              if (
                b.input &&
                typeof b.input === 'object' &&
                Object.keys(b.input as object).length > 0
              ) {
                events.push({
                  type: 'tool_input',
                  toolId: b.id,
                  toolName: b.name,
                  inputDelta: JSON.stringify(b.input, null, 2),
                });
              }
            }
          }
        }
        return events;
      }

      case 'user': {
        // Tool results from the CLI executing tools on behalf of the model.
        const content = (parsed.message as { content?: unknown[] } | undefined)?.content;
        const events: StreamEvent[] = [];
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
              const tool = activeTools.get(b.tool_use_id);
              if (tool) {
                const durationMs = Date.now() - tool.startMs;
                activeTools.delete(b.tool_use_id);
                events.push({
                  type: 'tool_complete',
                  toolId: b.tool_use_id,
                  toolName: tool.name,
                  durationMs,
                });
              }
            }
          }
        }
        // A new assistant turn will follow — reset per-turn progress counters.
        textProgress.clear();
        thinkingProgress.clear();
        return events;
      }

      case 'result': {
        // Capture native session ID from result event for session resume
        if (typeof parsed.session_id === 'string' && parsed.session_id) {
          this._nativeSessionId = parsed.session_id;
          this._firstCallDone = true;
          claudeLogger.debug('Captured native session ID from stream', {
            sessionId: parsed.session_id,
          });
        }
        const isError =
          parsed.is_error === true ||
          parsed.subtype === 'error_max_turns' ||
          parsed.subtype === 'error_during_execution';
        if (isError) {
          const result =
            typeof parsed.result === 'string'
              ? parsed.result.trim().slice(0, DEFAULTS.MAX_ERROR_PREVIEW_LENGTH)
              : 'Error during execution';
          return [{ type: 'error', error: result }];
        }
        return [{ type: 'complete' }];
      }

      // 'system' (init) and all other events — no StreamEvent emitted.
      default:
        return [];
    }
  }

  async stop(): Promise<void> {
    if (this._process && this._process.exitCode === null) {
      this._process.kill();
      this._process = null;
    }
    this._alive = false;
  }

  /** Build args for non-streaming (send) calls — plain text output. */
  private buildArgs(message: string): string[] {
    return this.buildArgsInternal(message, false);
  }

  /** Build args for streaming calls — includes --output-format stream-json. */
  private buildStreamingArgs(message: string): string[] {
    return this.buildArgsInternal(message, true);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI flag mapping is inherently branchy
  private buildArgsInternal(message: string, streaming: boolean): string[] {
    const args: string[] = [];

    // Session resume: if we have a native session ID from a previous call, resume it.
    // This lets Claude maintain conversation context natively without re-injecting history.
    if (this._nativeSessionId) {
      args.push('--resume', this._nativeSessionId, '-p', message);
    } else {
      args.push('-p', message);
    }

    // Only pass system prompt and config on first call — session stores it after that
    if (!this._firstCallDone) {
      if (this.config.systemPrompt) {
        args.push('--system-prompt', this.config.systemPrompt);
      }
      if (this.config.tools && this.config.tools.length > 0) {
        args.push('--allowed-tools', ...this.config.tools);
      }
      if (this.config.skipPermissions === true) {
        args.push('--dangerously-skip-permissions');
      }
      if (this.config.model) {
        args.push('--model', this.config.model);
      }
      if (this.config.extraFlags) {
        for (const [flag, value] of Object.entries(this.config.extraFlags)) {
          args.push(flag, value);
        }
      }
    }

    // Structured output: JSON for non-streaming (to capture session_id),
    // stream-json for streaming (NDJSON events including session_id in result).
    if (streaming) {
      args.push('--verbose', '--output-format', 'stream-json');
    } else {
      args.push('--output-format', 'json');
    }

    return args;
  }
}

export class ClaudeBackend implements CLIBackend {
  readonly name = AIBackend.CLAUDE;
  readonly capabilities = BACKEND_CAPABILITIES[AIBackend.CLAUDE];

  getConfigOptions(): BackendConfigOption[] {
    return [
      {
        name: 'model',
        cliFlag: '--model',
        description: 'Model alias or full name',
        values: ['sonnet', 'opus', 'haiku'],
        defaultValue: 'sonnet',
      },
      {
        name: 'effort',
        cliFlag: '--effort',
        description: 'Reasoning effort level',
        values: ['low', 'medium', 'high'],
      },
    ];
  }

  async spawn(config: BackendSpawnConfig): Promise<BackendProcess> {
    return new ClaudeProcess(config);
  }

  async logout(): Promise<void> {
    const env = buildSafeEnv();
    const proc = Bun.spawn(['claude', 'auth', 'logout'], {
      cwd: process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr as ReadableStream).text();
      throw new BackendError('claude', `Logout failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  async getStatus(): Promise<BackendStatus> {
    return getCliBackendStatus({
      name: this.name,
      cliBinary: 'claude',
      apiKeyEnvVars: ['ANTHROPIC_API_KEY'],
      capabilities: this.capabilities,
      checkAuth: () =>
        checkCliAuth(['claude', 'auth', 'status', '--json'], buildSafeEnv(), (exitCode, stdout) => {
          if (exitCode !== 0) return false;
          const parsed = JSON.parse(stdout.trim()) as { loggedIn?: boolean };
          return parsed.loggedIn === true;
        }),
    });
  }
}
