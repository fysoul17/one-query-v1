import type {
  AgentId,
  AgentRuntimeInfo,
  ConductorDecision,
  MemorySearchResult,
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
}

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
