import type {
  AgentId,
  ConductorDecision,
  HookRegistryInterface,
  SessionMessage,
} from '@autonomy/shared';
import type { SoulConfig } from './soul.ts';

export interface IncomingMessage {
  content: string;
  senderId: string;
  senderName: string;
  sessionId?: string;
  targetAgentId?: AgentId;
  metadata?: Record<string, unknown>;
  /** Ordered conversation history (oldest first) for the current session, excluding the current message. */
  conversationHistory?: SessionMessage[];
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
  /** Optional fallback backend when the primary backend fails to spawn. */
  fallbackBackend?: import('@autonomy/agent-manager').CLIBackend;
  /** API key for LLM-powered entity extraction (populates knowledge graph). */
  llmApiKey?: string;
  /** Conductor's constitutional soul — loaded from data/soul.md at boot. */
  soul?: SoulConfig;
}

export const ConductorEventType = {
  QUEUED: 'queued',
  MEMORY_SEARCH: 'memory_search',
  CONTEXT_INJECT: 'context_inject',
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
  /** Number of conversation history messages injected into the prompt. */
  historyTurnCount?: number;
  /** Total character count of injected history. */
  historyChars?: number;
}

export type OnConductorEvent = (event: ConductorEvent) => void;
