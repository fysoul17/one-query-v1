import {
  type AIBackend,
  DEFAULTS,
  type EnvironmentConfig,
  type LogLevel,
  type RuntimeMode,
  type VectorProvider,
} from '@autonomy/shared';

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

  const authEnabled = env.AUTH_ENABLED === 'true';

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
    MEMORY_URL: env.MEMORY_URL,
    AUTH_ENABLED: authEnabled,
    AUTH_MASTER_KEY: env.AUTH_MASTER_KEY,
  };
}
