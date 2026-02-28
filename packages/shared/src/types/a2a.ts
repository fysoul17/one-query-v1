export const AIBackend = {
  CLAUDE: 'claude',
  CODEX: 'codex',
  GEMINI: 'gemini',
  PI: 'pi',
  OLLAMA: 'ollama',
} as const;
export type AIBackend = (typeof AIBackend)[keyof typeof AIBackend];

export interface BackendCapabilities {
  customTools: boolean;
  streaming: boolean;
  sessionPersistence: boolean;
  fileAccess: boolean;
}

export type BackendCapabilityMap = Record<AIBackend, BackendCapabilities>;

/** Runtime status of a registered backend. */
export interface BackendStatus {
  name: AIBackend;
  /** Whether the CLI binary is available on PATH. */
  available: boolean;
  /** Whether authentication is configured (API key or verified CLI login). */
  configured: boolean;
  /** Whether the user is verified as authenticated (via `claude auth status --json` or API key). */
  authenticated: boolean;
  /** Masked API key hint (e.g. "sk-ant-...7x4Q"), if applicable. */
  apiKeyMasked?: string;
  /** Auth mode detected: 'api_key', 'cli_login', or 'none'. */
  authMode: 'api_key' | 'cli_login' | 'none';
  capabilities: BackendCapabilities;
  /** Error message if the backend is unavailable. */
  error?: string;
}

/** A configurable option exposed by a CLI backend (e.g., model, effort). */
export interface BackendConfigOption {
  /** Canonical name used as the slash command (e.g., 'model', 'effort'). */
  name: string;
  /** The CLI flag this maps to (e.g., '--model'). */
  cliFlag: string;
  /** Description shown to users. */
  description: string;
  /** Known valid values, if enumerable (e.g., ['sonnet', 'opus', 'haiku']). */
  values?: string[];
  /** Current default value. */
  defaultValue?: string;
}
