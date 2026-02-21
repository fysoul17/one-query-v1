import type { AgentDefinition, AgentId, AgentRuntimeInfo, StreamEvent } from '@autonomy/shared';
import { AgentStatus, getErrorDetail, Logger } from '@autonomy/shared';
import type { BackendProcess, CLIBackend } from './backends/types.ts';
import { AgentStateError, BackendError } from './errors.ts';

export interface AgentProcessOptions {
  idleTimeoutMs?: number;
  cwd?: string;
}

interface QueuedMessage {
  message: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

export class AgentProcess {
  readonly id: AgentId;
  readonly definition: AgentDefinition;

  private backend: CLIBackend;
  private backendProcess: BackendProcess | null = null;
  private _status: AgentStatus = AgentStatus.STOPPED;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimeoutMs: number;
  private messageQueue: QueuedMessage[] = [];
  private processing = false;
  /** Session UUID, generated at construction for persistent agents. */
  private _sessionId: string | undefined;
  private cwd: string | undefined;
  private logger: Logger;

  constructor(definition: AgentDefinition, backend: CLIBackend, options?: AgentProcessOptions) {
    this.id = definition.id;
    this.definition = definition;
    this.backend = backend;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 0;
    this.cwd = options?.cwd;
    this.logger = new Logger({
      context: { source: 'agent-process', agentId: definition.id, agentName: definition.name },
    });
    // Auto-generate sessionId for persistent agents that don't have one
    this._sessionId =
      definition.sessionId ?? (definition.persistent ? crypto.randomUUID() : undefined);
  }

  get status(): AgentStatus {
    return this._status;
  }

  async start(): Promise<void> {
    if (
      this._status === AgentStatus.IDLE ||
      this._status === AgentStatus.ACTIVE ||
      this._status === AgentStatus.BUSY
    ) {
      throw new AgentStateError(this.id, this._status, 'start');
    }

    try {
      this.backendProcess = await this.backend.spawn({
        agentId: this.id,
        systemPrompt: this.definition.systemPrompt,
        tools: this.definition.tools,
        cwd: this.cwd,
        // canModifyFiles: true → skip Claude's permission prompts
        skipPermissions: this.definition.canModifyFiles,
        ...(this._sessionId
          ? {
              sessionId: this._sessionId,
              sessionPersistence: true,
            }
          : {}),
      });
      this._status = AgentStatus.IDLE;
      this.resetIdleTimer();
      this.logger.info('Agent started');
    } catch (error) {
      this._status = AgentStatus.ERROR;
      this.logger.error('Agent start failed', { error: getErrorDetail(error) });
      throw error;
    }
  }

  async sendMessage(message: string): Promise<string> {
    if (this._status === AgentStatus.STOPPED || this._status === AgentStatus.ERROR) {
      throw new AgentStateError(this.id, this._status, 'send message to');
    }

    if (this.processing) {
      return new Promise<string>((resolve, reject) => {
        this.messageQueue.push({ message, resolve, reject });
      });
    }

    return this.execute(message);
  }

  async *sendMessageStreaming(message: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    if (this._status === AgentStatus.STOPPED || this._status === AgentStatus.ERROR) {
      yield {
        type: 'error',
        error: `Cannot send message to agent "${this.id}" (status: ${this._status})`,
      };
      return;
    }

    const bp = this.backendProcess;
    if (!bp) {
      yield { type: 'error', error: `No process for agent "${this.id}"` };
      return;
    }

    this._status = AgentStatus.BUSY;
    this.clearIdleTimer();

    try {
      if (bp.sendStreaming) {
        yield* bp.sendStreaming(message, signal);
      } else {
        // Fallback: wrap non-streaming send as a stream
        const result = await bp.send(message);
        yield { type: 'chunk', content: result };
        yield { type: 'complete' };
      }
      this._status = AgentStatus.IDLE;
      this.resetIdleTimer();
    } catch (error) {
      this._status = AgentStatus.ERROR;
      const detail = getErrorDetail(error);
      this.logger.error('Streaming error', { error: detail });
      yield { type: 'error', error: detail };
    }
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
    if (this.backendProcess) {
      await this.backendProcess.stop();
    }
    this._status = AgentStatus.STOPPED;
    this.logger.info('Agent stopped');
    // Reject queued messages
    for (const queued of this.messageQueue) {
      queued.reject(new AgentStateError(this.id, AgentStatus.STOPPED, 'send message to'));
    }
    this.messageQueue = [];
    this.processing = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    this.backendProcess = null;
    await this.start();
  }

  toRuntimeInfo(): AgentRuntimeInfo {
    return {
      id: this.id,
      name: this.definition.name,
      role: this.definition.role,
      status: this._status,
      owner: this.definition.owner,
      persistent: this.definition.persistent,
      createdAt: this.definition.createdAt,
      sessionId: this._sessionId,
      backend: this.backend.name,
    };
  }

  private async execute(message: string): Promise<string> {
    this.processing = true;
    this._status = AgentStatus.BUSY;
    this.clearIdleTimer();

    try {
      const bp = this.backendProcess;
      if (!bp) throw new BackendError(this.backend.name, `No process for agent "${this.id}"`);
      const result = await bp.send(message);
      this._status = AgentStatus.IDLE;
      this.resetIdleTimer();
      this.processing = false;
      this.processQueue();
      return result;
    } catch (error) {
      this._status = AgentStatus.ERROR;
      this.processing = false;
      throw error;
    }
  }

  private processQueue(): void {
    if (this.messageQueue.length === 0) return;
    const next = this.messageQueue.shift();
    if (!next) return;
    this.execute(next.message).then(next.resolve, next.reject);
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (this._status === AgentStatus.IDLE) {
          this.logger.info('Agent stopped due to idle timeout', {
            idleTimeoutMs: this.idleTimeoutMs,
          });
          this.stop();
        }
      }, this.idleTimeoutMs);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
