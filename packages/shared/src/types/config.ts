import type { AIBackend } from './a2a.ts';
import type { LogLevel } from './base.ts';
import type { VectorProvider } from './memory.ts';

export const RuntimeMode = {
  STANDALONE: 'standalone',
  MANAGED: 'managed',
} as const;
export type RuntimeMode = (typeof RuntimeMode)[keyof typeof RuntimeMode];

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
  /** Allowed CORS origin (default '*'). */
  CORS_ORIGIN: string;
  /** Optional fallback backend when primary AI_BACKEND fails to spawn. */
  FALLBACK_BACKEND?: AIBackend;
  /** Enable the terminal WebSocket endpoint (default: true, opt-out with 'false'). */
  ENABLE_TERMINAL_WS: boolean;
  /** Enable advanced memory lifecycle routes (default: true, opt-out with 'false'). */
  ENABLE_ADVANCED_MEMORY: boolean;
  /** Number of retries when connecting to the memory server at startup. */
  MEMORY_RETRY_COUNT: number;
  /** Delay between memory connection retries in milliseconds. */
  MEMORY_RETRY_DELAY_MS: number;
}
