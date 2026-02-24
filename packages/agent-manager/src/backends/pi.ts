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

const piLogger = new Logger({ context: { source: 'pi-backend' } });

const DEFAULT_MODEL = 'openai/gpt-4.1';

function getDefaultModel(): string {
  return process.env.PI_MODEL || DEFAULT_MODEL;
}

function maskApiKey(key: string | undefined): string | undefined {
  if (!key || key.length < 12) return undefined;
  return `sk-...${key.slice(-4)}`;
}

/** Env vars allowlisted for Pi child processes. */
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
  'PI_API_KEY',
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
  return env;
}

/**
 * Pi uses long-running RPC mode (`pi --mode rpc`).
 * A single process is spawned lazily and kept alive for the session.
 * Messages are written as JSON to stdin; NDJSON responses come from stdout.
 */
class PiProcess implements BackendProcess {
  private _alive = true;
  private _process: ReturnType<typeof Bun.spawn> | null = null;
  private config: BackendSpawnConfig;
  private _ensuring: Promise<void> | null = null;
  private _stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private _lineBuffer = '';
  private _decoder = new TextDecoder();

  constructor(config: BackendSpawnConfig) {
    this.config = config;
  }

  get alive(): boolean {
    if (this._process && this._process.exitCode !== null) {
      this._alive = false;
    }
    return this._alive;
  }

  /** Pi RPC process IS the session — no external session ID needed. */
  get nativeSessionId(): string | undefined {
    return undefined;
  }

  /** Lazily spawn the RPC process on first use. */
  private async ensureProcess(): Promise<void> {
    if (this._process && this._process.exitCode === null) return;
    if (this._ensuring) return this._ensuring;

    this._ensuring = (async () => {
      const model = this.config.model || getDefaultModel();
      const args = ['--mode', 'rpc', '--model', model];

      if (this.config.systemPrompt) {
        args.push('--system-prompt', this.config.systemPrompt);
      }

      const env = buildSafeEnv();

      piLogger.debug('Spawning Pi RPC process', { model, args });

      this._process = Bun.spawn(['pi', ...args], {
        cwd: this.config.cwd ?? process.cwd(),
        env,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdoutStream = this._process.stdout as ReadableStream;
      this._stdoutReader = stdoutStream.getReader();
      this._lineBuffer = '';
      this._ensuring = null;
    })();

    return this._ensuring;
  }

  async send(message: string): Promise<string> {
    if (!this._alive) {
      throw new BackendError('pi', 'Process is not alive');
    }

    await this.ensureProcess();

    const proc = this._process!;
    const stdin = proc.stdin as WritableStream;
    const writer = stdin.getWriter();

    // Write JSON message to stdin
    const request = JSON.stringify({ type: 'message', content: message }) + '\n';
    await writer.write(new TextEncoder().encode(request));
    writer.releaseLock();

    // Read NDJSON response lines until we get a complete response
    const chunks: string[] = [];
    let done = false;

    while (!done) {
      const line = await this.readLine();
      if (line === null) {
        throw new BackendError('pi', 'Process closed unexpectedly');
      }

      try {
        const parsed = JSON.parse(line) as {
          type: string;
          content?: string;
          done?: boolean;
          error?: string;
        };

        if (parsed.type === 'error') {
          throw new BackendError('pi', parsed.error ?? 'Unknown error');
        }

        if (parsed.content) {
          chunks.push(parsed.content);
        }

        if (parsed.done || parsed.type === 'result') {
          done = true;
        }
      } catch (e) {
        if (e instanceof BackendError) throw e;
        piLogger.debug('Failed to parse Pi NDJSON line', { line });
      }
    }

    return chunks.join('');
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
      await this.ensureProcess();
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      return;
    }

    const proc = this._process!;
    const stdin = proc.stdin as WritableStream;
    const writer = stdin.getWriter();

    const request = JSON.stringify({ type: 'message', content: message }) + '\n';
    await writer.write(new TextEncoder().encode(request));
    writer.releaseLock();

    while (true) {
      if (signal?.aborted) {
        yield { type: 'error', error: 'Aborted' };
        return;
      }

      const line = await this.readLine();
      if (line === null) {
        yield { type: 'error', error: 'Process closed unexpectedly' };
        return;
      }

      try {
        const parsed = JSON.parse(line) as {
          type: string;
          content?: string;
          done?: boolean;
          error?: string;
        };

        if (parsed.type === 'error') {
          yield { type: 'error', error: parsed.error ?? 'Unknown error' };
          return;
        }

        if (parsed.content) {
          yield { type: 'chunk', content: parsed.content };
        }

        if (parsed.done || parsed.type === 'result') {
          yield { type: 'complete' };
          return;
        }
      } catch {
        piLogger.debug('Failed to parse Pi NDJSON line in stream', { line });
      }
    }
  }

  /** Read a single newline-delimited line from stdout. Returns null on EOF. */
  private async readLine(): Promise<string | null> {
    const reader = this._stdoutReader;
    if (!reader) return null;

    while (true) {
      const newlineIdx = this._lineBuffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = this._lineBuffer.slice(0, newlineIdx).trim();
        this._lineBuffer = this._lineBuffer.slice(newlineIdx + 1);
        if (line) return line;
        continue;
      }

      const { done, value } = await reader.read();
      if (done) return null;

      this._lineBuffer += this._decoder.decode(value, { stream: true });
    }
  }

  async stop(): Promise<void> {
    if (this._stdoutReader) {
      try {
        this._stdoutReader.releaseLock();
      } catch {
        // ignore
      }
      this._stdoutReader = null;
    }
    if (this._process && this._process.exitCode === null) {
      this._process.kill();
      this._process = null;
    }
    this._alive = false;
  }
}

export class PiBackend implements CLIBackend {
  readonly name = AIBackend.PI;
  readonly capabilities = BACKEND_CAPABILITIES[AIBackend.PI];

  getConfigOptions(): BackendConfigOption[] {
    return [
      {
        name: 'model',
        cliFlag: '--model',
        description: 'Model name in provider/model format (e.g., openai/gpt-4.1, anthropic/claude-sonnet)',
        values: ['openai/gpt-4.1', 'openai/o3', 'anthropic/claude-sonnet', 'google/gemini-2.5-pro', 'ollama/llama3.2'],
        defaultValue: getDefaultModel(),
      },
    ];
  }

  async spawn(config: BackendSpawnConfig): Promise<BackendProcess> {
    return new PiProcess(config);
  }

  async getStatus(): Promise<BackendStatus> {
    const cliPath = typeof Bun !== 'undefined' ? Bun.which('pi') : null;
    const available = cliPath !== null;

    const apiKey = process.env.PI_API_KEY;
    const hasApiKey = !!apiKey;

    return {
      name: this.name,
      available,
      configured: available && hasApiKey,
      authenticated: hasApiKey,
      apiKeyMasked: maskApiKey(apiKey),
      authMode: hasApiKey ? 'api_key' : 'none',
      capabilities: this.capabilities,
      error: available ? undefined : 'pi CLI not found on PATH',
    };
  }
}
