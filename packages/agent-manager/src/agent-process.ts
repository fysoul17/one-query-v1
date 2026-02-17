import type { AgentDefinition, AgentId, AgentRuntimeInfo } from '@autonomy/shared';
import { AgentStatus, deriveLifecycle, isAgentPersistent } from '@autonomy/shared';
import type { BackendProcess, CLIBackend } from './backends/types.ts';
import { AgentStateError, BackendError } from './errors.ts';

export interface AgentProcessOptions {
  idleTimeoutMs?: number;
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

  constructor(definition: AgentDefinition, backend: CLIBackend, options?: AgentProcessOptions) {
    this.id = definition.id;
    this.definition = definition;
    this.backend = backend;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 0;
    // Auto-generate sessionId for persistent agents that don't have one
    this._sessionId =
      definition.sessionId ?? (isAgentPersistent(definition) ? crypto.randomUUID() : undefined);
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
        ...(this._sessionId
          ? {
              sessionId: this._sessionId,
              sessionPersistence: true,
            }
          : {}),
      });
      this._status = AgentStatus.IDLE;
      this.resetIdleTimer();
    } catch (error) {
      this._status = AgentStatus.ERROR;
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

  async stop(): Promise<void> {
    this.clearIdleTimer();
    if (this.backendProcess) {
      await this.backendProcess.stop();
    }
    this._status = AgentStatus.STOPPED;
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
      lifecycle: deriveLifecycle(this.definition),
      sessionId: this._sessionId,
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
