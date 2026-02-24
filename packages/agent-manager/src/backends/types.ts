import type {
  AIBackend,
  BackendCapabilities,
  BackendConfigOption,
  BackendStatus,
  StreamEvent,
} from '@autonomy/shared';

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
  /** Model alias or full name (e.g., 'sonnet', 'opus'). Backend translates to its own CLI flag. */
  model?: string;
  /** Arbitrary extra CLI flags from config options (key = CLI flag e.g. '--effort', value = user value). */
  extraFlags?: Record<string, string>;
}

/** A spawned backend process that can send/receive messages. */
export interface BackendProcess {
  /** Send a message and return the response text. */
  send(message: string): Promise<string>;
  /** Stream a response as a sequence of events. Optional — not all backends support it. */
  sendStreaming?(message: string, signal?: AbortSignal): AsyncGenerator<StreamEvent>;
  /** Stop the underlying process. Idempotent. */
  stop(): Promise<void>;
  /** Whether the process is currently alive and can receive messages. */
  readonly alive: boolean;
  /** Native session ID from the CLI backend (captured after first call). */
  readonly nativeSessionId: string | undefined;
}

/** Pluggable CLI backend for spawning AI agent processes. */
export interface CLIBackend {
  /** Backend identifier (e.g., 'claude', 'codex', 'gemini'). */
  readonly name: AIBackend;
  /** What this backend supports. */
  readonly capabilities: BackendCapabilities;
  /** Spawn a new process with the given configuration. */
  spawn(config: BackendSpawnConfig): Promise<BackendProcess>;
  /** Optional: check runtime availability, auth status, and capabilities. */
  getStatus?(): Promise<BackendStatus>;
  /** Optional: log out from the CLI backend (e.g., revoke CLI session). */
  logout?(): Promise<void>;
  /** Return the configurable options this backend exposes (e.g., model, effort). */
  getConfigOptions(): BackendConfigOption[];
}
