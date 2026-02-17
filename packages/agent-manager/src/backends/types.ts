import type { AIBackend, BackendCapabilities } from '@autonomy/shared';

/** Configuration passed to CLIBackend.spawn() to create a process. */
export interface BackendSpawnConfig {
  agentId: string;
  systemPrompt: string;
  tools?: string[];
  cwd?: string;
  /** Whether to skip permission checks. Default: true (for Docker sandbox). */
  skipPermissions?: boolean;
  /** Session UUID for conversation persistence (--session-id / --resume). */
  sessionId?: string;
  /** Whether to persist session to disk. Default: true. False = --no-session-persistence. */
  sessionPersistence?: boolean;
}

/** A spawned backend process that can send/receive messages. */
export interface BackendProcess {
  /** Send a message and return the response text. */
  send(message: string): Promise<string>;
  /** Stop the underlying process. Idempotent. */
  stop(): Promise<void>;
  /** Whether the process is currently alive and can receive messages. */
  readonly alive: boolean;
}

/** Pluggable CLI backend for spawning AI agent processes. */
export interface CLIBackend {
  /** Backend identifier (e.g., 'claude', 'codex', 'gemini'). */
  readonly name: AIBackend;
  /** What this backend supports. */
  readonly capabilities: BackendCapabilities;
  /** Spawn a new process with the given configuration. */
  spawn(config: BackendSpawnConfig): Promise<BackendProcess>;
}
