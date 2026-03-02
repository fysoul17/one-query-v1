import { AIBackend, LogLevel, RuntimeMode, VectorProvider } from '../types/index.ts';

export const DEFAULTS = {
  PORT: 7820,
  DATA_DIR: './data',
  RUNTIME_URL: 'http://localhost:7820',
  AI_BACKEND: AIBackend.CLAUDE,
  IDLE_TIMEOUT_MS: 300_000,
  MAX_AGENTS: 10,
  VECTOR_PROVIDER: VectorProvider.LANCEDB,
  LOG_LEVEL: LogLevel.INFO,
  MODE: RuntimeMode.STANDALONE,
  MEMORY_SERVER_PORT: 7822,
  RATE_LIMIT_MAX: 100,
  RATE_LIMIT_WINDOW_MS: 60_000,
  TRUST_PROXY: false,
  STREAM_TIMEOUT_MS: 300_000,
  /** Max characters to include in error preview strings (e.g. stderr truncation). */
  MAX_ERROR_PREVIEW_LENGTH: 500,
  MEMORY_RETRY_COUNT: 5,
  MEMORY_RETRY_DELAY_MS: 2000,
} as const;
