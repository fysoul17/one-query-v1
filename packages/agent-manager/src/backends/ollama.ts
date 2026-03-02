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
import { readNDJSONStream } from './ndjson-stream.ts';
import type { BackendProcess, BackendSpawnConfig, CLIBackend } from './types.ts';

const ollamaLogger = new Logger({ context: { source: 'ollama-backend' } });

const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Maximum number of messages to keep in conversation history (system prompt excluded). */
const MAX_HISTORY_MESSAGES = 100;

function getBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
}

function getDefaultModel(): string {
  return process.env.OLLAMA_MODEL || DEFAULT_MODEL;
}

/**
 * Ollama uses HTTP API (not CLI spawn).
 * Each OllamaProcess maintains a conversation history for multi-turn chat.
 * Messages are sent via POST /api/chat with streaming NDJSON responses.
 */
class OllamaProcess implements BackendProcess {
  private _alive = true;
  private config: BackendSpawnConfig;
  private messages: Array<{ role: string; content: string }> = [];
  private _abortController: AbortController | null = null;

  constructor(config: BackendSpawnConfig) {
    this.config = config;
    // Seed system prompt as first message
    if (config.systemPrompt) {
      this.messages.push({ role: 'system', content: config.systemPrompt });
    }
  }

  get alive(): boolean {
    return this._alive;
  }

  /** Ollama manages conversations in-memory — no native session ID. */
  get nativeSessionId(): string | undefined {
    return undefined;
  }

  async send(message: string): Promise<string> {
    if (!this._alive) {
      throw new BackendError('ollama', 'Process is not alive');
    }

    const chunks: string[] = [];
    for await (const event of this.sendStreaming(message)) {
      if (event.type === 'chunk' && event.content) {
        chunks.push(event.content);
      } else if (event.type === 'error') {
        throw new BackendError('ollama', event.error ?? 'Unknown error');
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

    // Add user message to history
    this.messages.push({ role: 'user', content: message });

    // Trim history to prevent unbounded growth (keep system prompt + last N messages)
    const systemMessages = this.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = this.messages.filter((m) => m.role !== 'system');
    if (nonSystemMessages.length > MAX_HISTORY_MESSAGES) {
      this.messages = [...systemMessages, ...nonSystemMessages.slice(-MAX_HISTORY_MESSAGES)];
    }

    const model = this.config.model || getDefaultModel();
    const baseUrl = getBaseUrl();

    this._abortController = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([signal, this._abortController.signal])
      : this._abortController.signal;

    // Build request body — include tools if configured
    const requestBody: Record<string, unknown> = {
      model,
      messages: this.messages,
      stream: true,
    };
    if (this.config.tools && this.config.tools.length > 0) {
      requestBody.tools = this.config.tools.map((name) => ({
        type: 'function',
        function: { name, description: name, parameters: { type: 'object', properties: {} } },
      }));
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      });
    } catch (error) {
      const msg = getErrorDetail(error);
      if (msg.includes('aborted') || msg.includes('abort')) {
        yield { type: 'error', error: 'Aborted' };
      } else {
        yield { type: 'error', error: `Failed to connect to Ollama at ${baseUrl}: ${msg}` };
      }
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      yield {
        type: 'error',
        error: `Ollama API error (${response.status}): ${body.slice(0, DEFAULTS.MAX_ERROR_PREVIEW_LENGTH)}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'Ollama returned no response body' };
      return;
    }

    const reader = response.body.getReader();
    const assistantChunks: string[] = [];

    try {
      for await (const line of readNDJSONStream(reader)) {
        if (combinedSignal.aborted) {
          yield { type: 'error', error: 'Aborted' };
          return;
        }

        if (line.type === 'text') {
          ollamaLogger.debug('Failed to parse Ollama NDJSON line', { line: line.data });
          continue;
        }

        const parsed = line.data as {
          message?: { role?: string; content?: string };
          done?: boolean;
          error?: string;
        };

        if (parsed.error) {
          yield { type: 'error', error: parsed.error };
          return;
        }

        if (parsed.message?.content) {
          assistantChunks.push(parsed.message.content);
          yield { type: 'chunk', content: parsed.message.content };
        }

        if (parsed.done) {
          this.messages.push({ role: 'assistant', content: assistantChunks.join('') });
          yield { type: 'complete' };
          return;
        }
      }

      // Stream ended without explicit done=true — store and complete
      if (assistantChunks.length > 0) {
        this.messages.push({ role: 'assistant', content: assistantChunks.join('') });
      }
      yield { type: 'complete' };
    } catch (error) {
      yield { type: 'error', error: getErrorDetail(error) };
    } finally {
      this._abortController = null;
    }
  }

  async stop(): Promise<void> {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._alive = false;
  }
}

export class OllamaBackend implements CLIBackend {
  readonly name = AIBackend.OLLAMA;
  readonly capabilities = BACKEND_CAPABILITIES[AIBackend.OLLAMA];

  getConfigOptions(): BackendConfigOption[] {
    return [
      {
        name: 'model',
        cliFlag: '--model',
        description: 'Ollama model name (e.g., llama3.2, mistral, codellama)',
        values: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'gemma2', 'phi3'],
        defaultValue: getDefaultModel(),
      },
    ];
  }

  async spawn(config: BackendSpawnConfig): Promise<BackendProcess> {
    return new OllamaProcess(config);
  }

  async logout(): Promise<void> {
    // Ollama is local — no auth to clear
  }

  async getStatus(): Promise<BackendStatus> {
    const baseUrl = getBaseUrl();
    let available = false;

    try {
      const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      available = resp.ok;
    } catch {
      // Ollama not running
    }

    return {
      name: this.name,
      available,
      configured: available,
      authenticated: true, // Ollama is local, no auth needed
      authMode: 'none',
      capabilities: this.capabilities,
      error: available ? undefined : `Ollama not reachable at ${baseUrl}`,
    };
  }
}
