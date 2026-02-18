import type { Timestamp } from './base.ts';

// --- API Key Types ---

export const ApiKeyScope = {
  ADMIN: 'admin',
  READ: 'read',
  WRITE: 'write',
  AGENTS: 'agents',
  MEMORY: 'memory',
  CRONS: 'crons',
} as const;
export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  rateLimit: number;
  createdAt: Timestamp;
  expiresAt?: Timestamp;
  lastUsedAt?: Timestamp;
  enabled: boolean;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes: ApiKeyScope[];
  rateLimit?: number;
  expiresAt?: Timestamp;
}

export interface CreateApiKeyResponse {
  key: ApiKey;
  rawKey: string;
}

export interface UpdateApiKeyRequest {
  name?: string;
  scopes?: ApiKeyScope[];
  rateLimit?: number;
  enabled?: boolean;
}

// --- Usage Types ---

export interface UsageRecord {
  id: string;
  apiKeyId: string | null;
  endpoint: string;
  method: string;
  statusCode: number;
  timestamp: Timestamp;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface UsageSummary {
  apiKeyId: string | null;
  apiKeyName: string | null;
  requestCount: number;
  period: 'day' | 'month';
  periodStart: Timestamp;
}

export interface QuotaConfig {
  apiKeyId: string;
  maxRequestsPerDay: number;
  maxRequestsPerMonth: number;
  maxAgents: number;
}

// --- Billing Types ---

export const BillingEventType = {
  QUOTA_WARNING: 'quota_warning',
  QUOTA_EXCEEDED: 'quota_exceeded',
  KEY_CREATED: 'key_created',
  KEY_REVOKED: 'key_revoked',
} as const;
export type BillingEventType = (typeof BillingEventType)[keyof typeof BillingEventType];

export interface BillingWebhookEvent {
  type: BillingEventType;
  apiKeyId?: string;
  data: Record<string, unknown>;
  timestamp: Timestamp;
}

// --- Instance Registry Types ---

export const InstanceStatus = {
  HEALTHY: 'healthy',
  UNREACHABLE: 'unreachable',
  DRAINING: 'draining',
} as const;
export type InstanceStatus = (typeof InstanceStatus)[keyof typeof InstanceStatus];

export interface InstanceInfo {
  id: string;
  hostname: string;
  port: number;
  startedAt: Timestamp;
  lastHeartbeat: Timestamp;
  status: InstanceStatus;
  version: string;
  agentCount: number;
  memoryStatus: string;
}

export interface InstanceRegistryConfig {
  heartbeatIntervalMs: number;
  staleThresholdMs: number;
}
