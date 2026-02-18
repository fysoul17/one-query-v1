import type { AgentId, ConductorDecision, HookRegistryInterface } from '@autonomy/shared';

export interface IncomingMessage {
  content: string;
  senderId: string;
  senderName: string;
  sessionId?: string;
  targetAgentId?: AgentId;
  metadata?: Record<string, unknown>;
}

export interface ConductorResponse {
  content: string;
  agentId?: AgentId;
  decisions: ConductorDecision[];
}

export interface ConductorOptions {
  maxActivityLogSize?: number;
  maxAgents?: number;
  idleTimeoutMs?: number;
  maxDelegationDepth?: number;
  maxQueueDepth?: number;
  /** Custom system prompt for the conductor's AI process. */
  systemPrompt?: string;
  /** Optional hook registry for plugin system integration. */
  hookRegistry?: HookRegistryInterface;
}

export const ConductorEventType = {
  QUEUED: 'queued',
  MEMORY_SEARCH: 'memory_search',
  DELEGATING: 'delegating',
  DELEGATION_COMPLETE: 'delegation_complete',
  RESPONDING: 'responding',
  MEMORY_STORE: 'memory_store',
} as const;
export type ConductorEventType = (typeof ConductorEventType)[keyof typeof ConductorEventType];

export interface ConductorEvent {
  type: ConductorEventType;
  agentId?: string;
  agentName?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  durationMs?: number;
  memoryResults?: number;
  memoryQuery?: string;
  memoryEntryPreviews?: string[];
  decisions?: ConductorDecision[];
  dispatchTarget?: string;
}

export type OnConductorEvent = (event: ConductorEvent) => void;

export interface DelegationStep {
  agentId: AgentId;
  task: string;
  context?: string;
}

export interface DelegationPipelineResult {
  steps: Array<{
    agentId: AgentId;
    result: string;
    success: boolean;
    error?: string;
  }>;
  finalResult: string;
  success: boolean;
}
