import type { AgentRuntimeInfo, ConductorDebugPayload } from '@autonomy/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface PipelinePhase {
  phase: string;
  message: string;
  timestamp: number;
  durationMs?: number;
  debug?: ConductorDebugPayload;
}

export type ToolCallStatus = 'streaming' | 'complete';

export interface AgentToolCall {
  toolId: string;
  toolName: string;
  accumulatedInput: string;
  status: ToolCallStatus;
  durationMs?: number;
  startedAt: number;
  completedAt?: number;
}

export interface AgentThinking {
  content: string;
  timestamp: number;
}

export interface AgentActivity {
  agentId: string;
  agentName?: string;
  toolCalls: AgentToolCall[];
  thinkingBlocks: AgentThinking[];
}

export interface ActivityFeed {
  agents: AgentActivity[];
  totalSteps: number;
  totalDurationMs: number;
  isActive: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: number;
  streaming?: boolean;
  pipeline?: PipelinePhase[];
  activityFeed?: ActivityFeed;
  isProcessing?: boolean;
}

export interface UseWebSocketOptions {
  url: string;
  onAgentStatus?: (agents: AgentRuntimeInfo[], conductorName?: string) => void;
  onSessionInit?: (sessionId: string) => void;
  initialMessages?: ChatMessage[];
}
