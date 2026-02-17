import type { AIBackend } from './a2a.ts';
import type { AgentId, Timestamp } from './base.ts';
import type { PlatformConfig } from './config.ts';
import type { CronWorkflow } from './cron.ts';
import type { AgentLifecycle } from './session.ts';

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
  /** Agent lifecycle type. When set, overrides `persistent` flag semantics. */
  lifecycle?: AgentLifecycle;
  /** Which AI backend to use for this agent. */
  backend?: AIBackend;
  /** Department namespace for memory scoping. */
  department?: string;
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

export type UpdateConfigRequest = Partial<PlatformConfig>;

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
