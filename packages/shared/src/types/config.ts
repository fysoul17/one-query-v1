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
}
