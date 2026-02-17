import type {
  AgentId,
  AgentRuntimeInfo,
  ConductorDecision,
  ConductorPersonality,
  MemorySearchResult,
  PendingQuestion,
} from '@autonomy/shared';

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

export interface RoutingResult {
  agentIds: AgentId[];
  createAgent?: {
    name: string;
    role: string;
    systemPrompt: string;
  };
  directResponse?: boolean;
  /** Pre-generated response from combined routing+response call. If present, skips the second AI call. */
  response?: string;
  /** AI decides whether this conversation is worth remembering. Defaults to true when undefined. */
  storeInMemory?: boolean;
  reason: string;
}

export type RouterFn = (
  message: IncomingMessage,
  agents: AgentRuntimeInfo[],
  memoryContext: MemorySearchResult | null,
) => Promise<RoutingResult>;

export interface ConductorOptions {
  maxActivityLogSize?: number;
  systemPrompt?: string;
  maxAgents?: number;
  idleTimeoutMs?: number;
  maxDelegationDepth?: number;
  maxQueueDepth?: number;
  /** Conductor's own session UUID for stateful personality via --resume. */
  sessionId?: string;
  /** User-chosen conductor personality name (e.g., 'JARVIS', 'Friday'). */
  conductorName?: string;
  /** Conductor personality configuration. */
  personality?: ConductorPersonality;
  /** Expiry time for pending questions in ms (default 30 min). */
  questionExpiryMs?: number;
  /** Max unrelated messages before a pending question expires (default 3). */
  maxUnrelatedMessages?: number;
}

export interface RoutingContext {
  message: IncomingMessage;
  agents: AgentRuntimeInfo[];
  memoryContext: MemorySearchResult | null;
  pendingQuestions?: PendingQuestion[];
  personality?: ConductorPersonality;
}

export const ConductorEventType = {
  QUEUED: 'queued',
  ROUTING: 'routing',
  CREATING_AGENT: 'creating_agent',
  AGENT_CREATED: 'agent_created',
  DELEGATING: 'delegating',
  MEMORY_SEARCH: 'memory_search',
  ROUTING_COMPLETE: 'routing_complete',
  MEMORY_STORE: 'memory_store',
  DELEGATION_COMPLETE: 'delegation_complete',
  RESPONDING: 'responding',
  QUESTION_ASKED: 'question_asked',
  QUESTION_ANSWERED: 'question_answered',
  QUESTION_EXPIRED: 'question_expired',
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
  routerType?: 'ai' | 'keyword';
  decisions?: ConductorDecision[];
  dispatchTarget?: string;
}

export type OnConductorEvent = (event: ConductorEvent) => void;

export interface PermissionCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

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
