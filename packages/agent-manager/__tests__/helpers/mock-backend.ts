/**
 * MockBackend — production-quality test infrastructure for agent-manager.
 *
 * Implements the CLIBackend interface so AgentProcess and AgentPool tests
 * can run without spawning real CLI processes.
 */
import type { AIBackend, BackendCapabilities, BackendConfigOption } from '@autonomy/shared';
import type { BackendProcess, BackendSpawnConfig, CLIBackend } from '../../src/backends/types.ts';

// ---- MockBackendProcess ----

export class MockBackendProcess implements BackendProcess {
  private _alive = true;
  private _responses: string[];
  private _callIndex = 0;

  /** All messages sent to this process, for assertion purposes. */
  public readonly sentMessages: string[] = [];

  /** If set, send() will reject with this error. */
  public errorToThrow: Error | null = null;

  /** Delay (ms) before resolving send(). Useful for concurrency tests. */
  public sendDelayMs = 0;

  constructor(responses: string[] = ['mock response']) {
    this._responses = responses;
  }

  get alive(): boolean {
    return this._alive;
  }

  get nativeSessionId(): string | undefined {
    return undefined;
  }

  async send(message: string): Promise<string> {
    if (!this._alive) {
      throw new Error('Process is not alive');
    }

    this.sentMessages.push(message);

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    if (this.sendDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.sendDelayMs));
    }

    const response = this._responses[this._callIndex % this._responses.length];
    this._callIndex++;
    return response;
  }

  async stop(): Promise<void> {
    this._alive = false;
  }
}

// ---- MockBackend ----

export class MockBackend implements CLIBackend {
  readonly name: AIBackend;
  readonly capabilities: BackendCapabilities;

  /** All spawn() calls recorded for assertions. */
  public readonly spawnCalls: BackendSpawnConfig[] = [];

  /** The processes created by spawn(), in order. */
  public readonly spawnedProcesses: MockBackendProcess[] = [];

  /** Pre-configured responses for new processes. */
  private _responses: string[];

  /** If set, spawn() will reject with this error. */
  public spawnError: Error | null = null;

  /** Delay (ms) before resolving send() on spawned processes. */
  public sendDelayMs = 0;

  /** If set, spawned processes will throw this error on send(). */
  public processErrorToThrow: Error | null = null;

  constructor(
    name: AIBackend = 'claude' as AIBackend,
    capabilities: BackendCapabilities = {
      customTools: true,
      streaming: true,
      sessionPersistence: true,
      fileAccess: true,
    },
    responses: string[] = ['mock response'],
  ) {
    this.name = name;
    this.capabilities = capabilities;
    this._responses = responses;
  }

  async spawn(config: BackendSpawnConfig): Promise<BackendProcess> {
    this.spawnCalls.push(config);

    if (this.spawnError) {
      throw this.spawnError;
    }

    const process = new MockBackendProcess(this._responses);
    process.sendDelayMs = this.sendDelayMs;
    if (this.processErrorToThrow) {
      process.errorToThrow = this.processErrorToThrow;
    }
    this.spawnedProcesses.push(process);
    return process;
  }

  getConfigOptions(): BackendConfigOption[] {
    return [];
  }

  /** Configure response sequence for subsequently spawned processes. */
  setResponses(responses: string[]): void {
    this._responses = responses;
  }
}
