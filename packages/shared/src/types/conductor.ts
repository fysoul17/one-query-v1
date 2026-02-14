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
  action: 'route' | 'delegate' | 'create_agent' | 'synthesize' | 'store_memory';
  targetAgentId?: AgentId;
  reason: string;
}
