import {
  DEFAULTS,
  LogLevel,
  RuntimeMode,
  VectorProvider,
  type AIBackend,
  type EnvironmentConfig,
} from '@autonomy/shared';

export function parseEnvConfig(): EnvironmentConfig {
  const env = typeof Bun !== 'undefined' ? Bun.env : process.env;

  const port = parseInt(env.PORT ?? String(DEFAULTS.PORT), 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: "${env.PORT}" — must be a number between 0 and 65535`);
  }

  const idleTimeout = parseInt(
    env.IDLE_TIMEOUT_MS ?? String(DEFAULTS.IDLE_TIMEOUT_MS),
    10,
  );
  if (Number.isNaN(idleTimeout) || idleTimeout < 0) {
    throw new Error(`Invalid IDLE_TIMEOUT_MS: "${env.IDLE_TIMEOUT_MS}"`);
  }

  const maxAgents = parseInt(env.MAX_AGENTS ?? String(DEFAULTS.MAX_AGENTS), 10);
  if (Number.isNaN(maxAgents) || maxAgents < 1) {
    throw new Error(`Invalid MAX_AGENTS: "${env.MAX_AGENTS}"`);
  }

  const aiBackend = (env.AI_BACKEND ?? DEFAULTS.AI_BACKEND) as AIBackend;
  const vectorProvider = (env.VECTOR_PROVIDER ?? DEFAULTS.VECTOR_PROVIDER) as typeof VectorProvider[keyof typeof VectorProvider];
  const logLevel = (env.LOG_LEVEL ?? DEFAULTS.LOG_LEVEL) as typeof LogLevel[keyof typeof LogLevel];
  const mode = (env.MODE ?? DEFAULTS.MODE) as typeof RuntimeMode[keyof typeof RuntimeMode];

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
  };
}
