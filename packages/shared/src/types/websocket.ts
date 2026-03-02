import type { AgentRuntimeInfo } from './agent.ts';
import type { AgentId } from './base.ts';
import type { ConductorDebugPayload } from './conductor.ts';
import type { DebugEvent, DebugEventCategory, DebugEventLevel } from './debug.ts';

export const WSClientMessageType = {
  MESSAGE: 'message',
  PING: 'ping',
  CANCEL: 'cancel',
  DEBUG_SUBSCRIBE: 'debug_subscribe',
} as const;
export type WSClientMessageType = (typeof WSClientMessageType)[keyof typeof WSClientMessageType];

export const WSServerMessageType = {
  CHUNK: 'chunk',
  COMPLETE: 'complete',
  ERROR: 'error',
  PONG: 'pong',
  AGENT_STATUS: 'agent_status',
  CONDUCTOR_STATUS: 'conductor_status',
  DEBUG_EVENT: 'debug_event',
  DEBUG_HISTORY: 'debug_history',
  SESSION_INIT: 'session_init',
  STREAM_RESUME: 'stream_resume',
  AGENT_STEP: 'agent_step',
} as const;

export type AgentStepType = 'tool_start' | 'tool_input' | 'tool_complete' | 'thinking';
export type WSServerMessageType = (typeof WSServerMessageType)[keyof typeof WSServerMessageType];

export interface WSClientMessage {
  type: WSClientMessageType;
  content?: string;
  targetAgent?: AgentId;
}

export interface WSClientDebugSubscribe {
  type: typeof WSClientMessageType.DEBUG_SUBSCRIBE;
  filter?: {
    categories?: DebugEventCategory[];
    minLevel?: DebugEventLevel;
  };
}

export interface WSServerChunk {
  type: typeof WSServerMessageType.CHUNK;
  content: string;
  agentId: AgentId;
  agentName?: string;
}

export interface WSServerComplete {
  type: typeof WSServerMessageType.COMPLETE;
}

export interface WSServerError {
  type: typeof WSServerMessageType.ERROR;
  message: string;
}

export interface WSServerPong {
  type: typeof WSServerMessageType.PONG;
}

export interface WSServerAgentStatus {
  type: typeof WSServerMessageType.AGENT_STATUS;
  agents: AgentRuntimeInfo[];
  conductorName?: string;
}

export interface WSServerConductorStatus {
  type: typeof WSServerMessageType.CONDUCTOR_STATUS;
  phase:
    | 'queued'
    | 'analyzing'
    | 'creating_agent'
    | 'delegating'
    | 'memory_search'
    | 'context_inject'
    | 'routing_complete'
    | 'memory_store'
    | 'delegation_complete'
    | 'responding';
  message: string;
  agentName?: string;
  debug?: ConductorDebugPayload;
}

export interface WSServerDebugEvent {
  type: typeof WSServerMessageType.DEBUG_EVENT;
  event: DebugEvent;
}

export interface WSServerDebugHistory {
  type: typeof WSServerMessageType.DEBUG_HISTORY;
  events: DebugEvent[];
}

export interface WSServerSessionInit {
  type: typeof WSServerMessageType.SESSION_INIT;
  sessionId: string;
}

export interface WSServerStreamResume {
  type: typeof WSServerMessageType.STREAM_RESUME;
  content: string;
  agentId: AgentId;
  streaming: boolean;
}

export interface WSServerAgentStep {
  type: typeof WSServerMessageType.AGENT_STEP;
  stepType: AgentStepType;
  agentId: AgentId;
  agentName?: string;
  toolId?: string;
  toolName?: string;
  inputDelta?: string;
  content?: string;
  durationMs?: number;
  timestamp: string;
}

export type WSServerMessage =
  | WSServerChunk
  | WSServerComplete
  | WSServerError
  | WSServerPong
  | WSServerAgentStatus
  | WSServerConductorStatus
  | WSServerDebugEvent
  | WSServerDebugHistory
  | WSServerSessionInit
  | WSServerStreamResume
  | WSServerAgentStep;
