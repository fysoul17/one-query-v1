import { DEFAULTS, type EmbeddingProviderName } from '@autonomy/shared';

export interface MemoryServerConfig {
  PORT: number;
  DATA_DIR: string;
  EMBEDDING_PROVIDER: EmbeddingProviderName;
  EMBEDDING_API_KEY?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSIONS?: number;
  NEO4J_URL?: string;
  NEO4J_USERNAME?: string;
  NEO4J_PASSWORD?: string;
}

export function parseMemoryServerConfig(): MemoryServerConfig {
  const env = typeof Bun !== 'undefined' ? Bun.env : process.env;

  const portStr = env.MEMORY_SERVER_PORT ?? String(DEFAULTS.MEMORY_SERVER_PORT);
  const port = parseInt(portStr, 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: "${portStr}"`);
  }

  const embeddingDimStr = env.EMBEDDING_DIMENSIONS;
  let embeddingDimensions: number | undefined;
  if (embeddingDimStr) {
    embeddingDimensions = parseInt(embeddingDimStr, 10);
    if (Number.isNaN(embeddingDimensions) || embeddingDimensions < 1) {
      throw new Error(`Invalid EMBEDDING_DIMENSIONS: "${embeddingDimStr}"`);
    }
  }

  return {
    PORT: port,
    DATA_DIR: env.DATA_DIR ?? DEFAULTS.DATA_DIR,
    EMBEDDING_PROVIDER: (env.EMBEDDING_PROVIDER ??
      DEFAULTS.EMBEDDING_PROVIDER) as EmbeddingProviderName,
    EMBEDDING_API_KEY: env.EMBEDDING_API_KEY,
    EMBEDDING_MODEL: env.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: embeddingDimensions,
    NEO4J_URL: env.NEO4J_URL,
    NEO4J_USERNAME: env.NEO4J_USERNAME ?? 'neo4j',
    NEO4J_PASSWORD: env.NEO4J_PASSWORD,
  };
}
