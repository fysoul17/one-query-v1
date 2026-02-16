import type { AgentRuntimeInfo } from './agent.ts';
import type { AgentId } from './base.ts';

export const WSClientMessageType = {
  MESSAGE: 'message',
  PING: 'ping',
} as const;
export type WSClientMessageType = (typeof WSClientMessageType)[keyof typeof WSClientMessageType];

export const WSServerMessageType = {
  CHUNK: 'chunk',
  COMPLETE: 'complete',
  ERROR: 'error',
  PONG: 'pong',
  AGENT_STATUS: 'agent_status',
  A2A_EVENT: 'a2a_event',
  CONDUCTOR_STATUS: 'conductor_status',
} as const;
export type WSServerMessageType = (typeof WSServerMessageType)[keyof typeof WSServerMessageType];

export interface WSClientMessage {
  type: WSClientMessageType;
  content?: string;
  targetAgent?: AgentId;
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
}

export interface WSServerA2AEvent {
  type: typeof WSServerMessageType.A2A_EVENT;
  fromAgentId: AgentId;
  toAgentId: AgentId;
  task: string;
}

export interface WSServerConductorStatus {
  type: typeof WSServerMessageType.CONDUCTOR_STATUS;
  phase: 'analyzing' | 'creating_agent' | 'delegating';
  message: string;
  agentName?: string;
}

export type WSServerMessage =
  | WSServerChunk
  | WSServerComplete
  | WSServerError
  | WSServerPong
  | WSServerAgentStatus
  | WSServerA2AEvent
  | WSServerConductorStatus;
