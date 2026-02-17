import type { AgentId, Timestamp } from './base.ts';

export const ConductorAction = {
  CREATE: 'create',
  MODIFY: 'modify',
  DELETE: 'delete',
  DELEGATE: 'delegate',
  READ: 'read',
  WRITE: 'write',
} as const;
export type ConductorAction = (typeof ConductorAction)[keyof typeof ConductorAction];

export const ConductorTarget = {
  OWN_AGENT: 'own-agent',
  USER_AGENT: 'user-agent',
  SELF: 'self',
  MEMORY: 'memory',
  CRON: 'cron',
} as const;
export type ConductorTarget = (typeof ConductorTarget)[keyof typeof ConductorTarget];

export interface ConductorPermissionRule {
  target: ConductorTarget;
  action: ConductorAction;
  allowed: boolean;
  requiresApproval: boolean;
}

export interface ConductorDecision {
  timestamp: Timestamp;
  action:
    | 'route'
    | 'delegate'
    | 'create_agent'
    | 'synthesize'
    | 'store_memory'
    | 'skip_memory'
    | 'ai_route'
    | 'ai_fallback'
    | 'direct_response';
  targetAgentId?: AgentId;
  reason: string;
}

export interface ConductorDebugPayload {
  durationMs?: number;
  memoryResults?: number;
  routerType?: 'ai' | 'keyword';
  routingReason?: string;
  targetAgentIds?: string[];
  decisions?: ConductorDecision[];
  memoryQuery?: string;
  memoryEntryPreviews?: string[];
  dispatchTarget?: string;
}

// --- Pending Question Tracking ---

export const QuestionStatus = {
  PENDING: 'pending',
  ANSWERED: 'answered',
  EXPIRED: 'expired',
} as const;
export type QuestionStatus = (typeof QuestionStatus)[keyof typeof QuestionStatus];

export interface PendingQuestion {
  id: string;
  agentId: string;
  agentName: string;
  question: string;
  createdAt: string;
  status: QuestionStatus;
  unrelatedMessageCount: number;
}

// --- Conductor Personality ---

export interface ConductorPersonality {
  name: string;
  communicationStyle?: string;
  traits?: string;
}

export interface ConductorIdentityConfig {
  personality?: ConductorPersonality;
  sessionId?: string;
}
