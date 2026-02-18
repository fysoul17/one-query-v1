import type { AgentId, Timestamp } from './base.ts';

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
    | 'direct_response'
    | 'plugin_reject';
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
