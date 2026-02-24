import type { AIBackend } from './a2a.ts';
import type { LogLevel } from './base.ts';
import type { VectorProvider } from './memory.ts';

export type ProviderApiKeys = Record<string, string>;

export const RuntimeMode = {
  STANDALONE: 'standalone',
  MANAGED: 'managed',
} as const;
export type RuntimeMode = (typeof RuntimeMode)[keyof typeof RuntimeMode];

export interface MemoryProviderConfig {
  vectorProvider: VectorProvider;
  qdrantUrl?: string;
}

export interface PlatformConfig {
  backend: AIBackend;
  apiKeys: ProviderApiKeys;
  defaultModel?: string;
  idleTimeoutMs: number;
  maxAgents: number;
  memory: MemoryProviderConfig;
}

export interface EnvironmentConfig {
  ANTHROPIC_API_KEY?: string;
  DATA_DIR: string;
  PORT: number;
  RUNTIME_URL: string;
  AI_BACKEND: AIBackend;
  IDLE_TIMEOUT_MS: number;
  MAX_AGENTS: number;
  VECTOR_PROVIDER: VectorProvider;
  QDRANT_URL?: string;
  LOG_LEVEL: LogLevel;
  MODE: RuntimeMode;
  MEMORY_URL?: string;
  /** Enable API key authentication (opt-in). */
  AUTH_ENABLED: boolean;
  /** Optional bootstrap admin key for initial setup. */
  AUTH_MASTER_KEY?: string;
  /** Max requests per rate limit window per IP. */
  RATE_LIMIT_MAX: number;
  /** Rate limit window duration in milliseconds. */
  RATE_LIMIT_WINDOW_MS: number;
  /** Trust X-Forwarded-For header for IP extraction. */
  TRUST_PROXY: boolean;
  /** Max stream duration in milliseconds for AI backend responses. */
  STREAM_TIMEOUT_MS: number;
  /** API key for Pi CLI (multi-provider gateway). */
  PI_API_KEY?: string;
  /** Default Pi model (e.g., openai/gpt-4.1, anthropic/claude-sonnet). */
  PI_MODEL?: string;
  /** API key for OpenAI Codex CLI. */
  CODEX_API_KEY?: string;
  /** API key for Google Gemini CLI. */
  GEMINI_API_KEY?: string;
}
