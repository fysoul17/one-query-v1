import {
  AIBackend,
  DEFAULTS,
  type EnvironmentConfig,
  type LogLevel,
  type RuntimeMode,
  type VectorProvider,
} from '@autonomy/shared';

const VALID_BACKENDS = new Set<string>(Object.values(AIBackend));

function parseIntEnv(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max?: number,
): number {
  const result = parseInt(value ?? String(fallback), 10);
  if (Number.isNaN(result) || result < min || (max !== undefined && result > max)) {
    throw new Error(`Invalid ${name}: "${value}"`);
  }
  return result;
}

export function parseEnvConfig(): EnvironmentConfig {
  const env = typeof Bun !== 'undefined' ? Bun.env : process.env;

  const port = parseIntEnv(env.PORT, DEFAULTS.PORT, 'PORT', 0, 65535);
  const idleTimeout = parseIntEnv(
    env.IDLE_TIMEOUT_MS,
    DEFAULTS.IDLE_TIMEOUT_MS,
    'IDLE_TIMEOUT_MS',
    0,
  );
  const maxAgents = parseIntEnv(env.MAX_AGENTS, DEFAULTS.MAX_AGENTS, 'MAX_AGENTS', 1);

  const aiBackend = (env.AI_BACKEND ?? DEFAULTS.AI_BACKEND) as AIBackend;
  const vectorProvider = (env.VECTOR_PROVIDER ??
    DEFAULTS.VECTOR_PROVIDER) as (typeof VectorProvider)[keyof typeof VectorProvider];
  const logLevel = (env.LOG_LEVEL ??
    DEFAULTS.LOG_LEVEL) as (typeof LogLevel)[keyof typeof LogLevel];
  const mode = (env.MODE ?? DEFAULTS.MODE) as (typeof RuntimeMode)[keyof typeof RuntimeMode];

  const rateLimitMax = parseIntEnv(
    env.RATE_LIMIT_MAX,
    DEFAULTS.RATE_LIMIT_MAX,
    'RATE_LIMIT_MAX',
    1,
  );
  const rateLimitWindowMs = parseIntEnv(
    env.RATE_LIMIT_WINDOW_MS,
    DEFAULTS.RATE_LIMIT_WINDOW_MS,
    'RATE_LIMIT_WINDOW_MS',
    1000,
  );
  const streamTimeoutMs = parseIntEnv(
    env.STREAM_TIMEOUT_MS,
    DEFAULTS.STREAM_TIMEOUT_MS,
    'STREAM_TIMEOUT_MS',
    1000,
  );
  const trustProxy = env.TRUST_PROXY === 'true';
  const memoryRetryCount = parseIntEnv(
    env.MEMORY_RETRY_COUNT,
    DEFAULTS.MEMORY_RETRY_COUNT,
    'MEMORY_RETRY_COUNT',
    0,
  );
  const memoryRetryDelayMs = parseIntEnv(
    env.MEMORY_RETRY_DELAY_MS,
    DEFAULTS.MEMORY_RETRY_DELAY_MS,
    'MEMORY_RETRY_DELAY_MS',
    0,
  );

  return {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    DATA_DIR: env.DATA_DIR ?? DEFAULTS.DATA_DIR,
    PORT: port,
    RUNTIME_URL: env.RUNTIME_URL ?? DEFAULTS.RUNTIME_URL,
    AI_BACKEND: aiBackend,
    IDLE_TIMEOUT_MS: idleTimeout,
    MAX_AGENTS: maxAgents,
    VECTOR_PROVIDER: vectorProvider,
    QDRANT_URL: env.QDRANT_URL,
    LOG_LEVEL: logLevel,
    MODE: mode,
    MEMORY_URL:
      env.MEMORY_URL ??
      (env.MEMORY_SERVER_PORT ? `http://localhost:${env.MEMORY_SERVER_PORT}` : undefined),
    RATE_LIMIT_MAX: rateLimitMax,
    RATE_LIMIT_WINDOW_MS: rateLimitWindowMs,
    TRUST_PROXY: trustProxy,
    STREAM_TIMEOUT_MS: streamTimeoutMs,
    PI_API_KEY: env.PI_API_KEY,
    PI_MODEL: env.PI_MODEL,
    CODEX_API_KEY: env.CODEX_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    CORS_ORIGIN: env.CORS_ORIGIN ?? 'http://localhost:7821',
    FALLBACK_BACKEND: parseFallbackBackend(env.FALLBACK_BACKEND),
    ENABLE_TERMINAL_WS: env.ENABLE_TERMINAL_WS !== 'false',
    ENABLE_ADVANCED_MEMORY: env.ENABLE_ADVANCED_MEMORY !== 'false',
    MEMORY_RETRY_COUNT: memoryRetryCount,
    MEMORY_RETRY_DELAY_MS: memoryRetryDelayMs,
  };
}

function parseFallbackBackend(value: string | undefined): AIBackend | undefined {
  if (!value) return undefined;
  if (!VALID_BACKENDS.has(value)) {
    throw new Error(
      `Invalid FALLBACK_BACKEND: "${value}". Valid values: ${[...VALID_BACKENDS].join(', ')}`,
    );
  }
  return value as AIBackend;
}
