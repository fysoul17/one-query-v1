import { AIBackend, EmbeddingProviderName, LogLevel, RuntimeMode, VectorProvider } from '../types/index.ts';

export const DEFAULTS = {
  PORT: 7820,
  DATA_DIR: './data',
  RUNTIME_URL: 'http://localhost:7820',
  AI_BACKEND: AIBackend.CLAUDE,
  IDLE_TIMEOUT_MS: 300_000,
  MAX_AGENTS: 10,
  VECTOR_PROVIDER: VectorProvider.LANCEDB,
  EMBEDDING_PROVIDER: EmbeddingProviderName.STUB,
  LOG_LEVEL: LogLevel.INFO,
  MODE: RuntimeMode.STANDALONE,
  MEMORY_SERVER_PORT: 7822,
  AUTH_ENABLED: false,
  RATE_LIMIT_MAX: 100,
  RATE_LIMIT_WINDOW_MS: 60_000,
  TRUST_PROXY: false,
  STREAM_TIMEOUT_MS: 300_000,
} as const;
