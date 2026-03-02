import type { AIBackend, BackendStatus } from './a2a.ts';
import type { AgentId, Timestamp } from './base.ts';
import type { CronWorkflow } from './cron.ts';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  agentCount: number;
  memoryStatus: string;
  version: string;
  backendStatus?: {
    default: string;
    backends: { name: string; available: boolean; authenticated: boolean }[];
  };
}

export interface CreateAgentRequest {
  name: string;
  role: string;
  tools: string[];
  canModifyFiles: boolean;
  canDelegateToAgents: boolean;
  maxConcurrent?: number;
  persistent: boolean;
  systemPrompt: string;
  /** Which AI backend to use for this agent. */
  backend?: AIBackend;
}

export interface UpdateAgentRequest {
  name?: string;
  role?: string;
  tools?: string[];
  canModifyFiles?: boolean;
  canDelegateToAgents?: boolean;
  maxConcurrent?: number;
  persistent?: boolean;
  systemPrompt?: string;
  /** Which AI backend to use for this agent. */
  backend?: AIBackend;
}

export interface CreateCronRequest {
  name: string;
  schedule: string;
  timezone?: string;
  enabled?: boolean;
  workflow: CronWorkflow;
}

export interface UpdateCronRequest {
  name?: string;
  schedule?: string;
  timezone?: string;
  enabled?: boolean;
  workflow?: CronWorkflow;
}

export interface BackendStatusResponse {
  defaultBackend: AIBackend;
  backends: BackendStatus[];
}

export const ActivityType = {
  MESSAGE: 'message',
  DELEGATION: 'delegation',
  AGENT_CREATED: 'agent_created',
  AGENT_DELETED: 'agent_deleted',
  CRON_EXECUTED: 'cron_executed',
  MEMORY_STORED: 'memory_stored',
  ERROR: 'error',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export interface ActivityEntry {
  id: string;
  timestamp: Timestamp;
  type: ActivityType;
  agentId?: AgentId;
  details: string;
  metadata?: Record<string, unknown>;
}
