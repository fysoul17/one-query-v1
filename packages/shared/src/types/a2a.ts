import type { AgentId } from './base.ts';

export const AIBackend = {
  CLAUDE: 'claude',
  CODEX: 'codex',
  GEMINI: 'gemini',
} as const;
export type AIBackend = (typeof AIBackend)[keyof typeof AIBackend];

export interface BackendCapabilities {
  customTools: boolean;
  streaming: boolean;
  sessionPersistence: boolean;
  fileAccess: boolean;
}

export type BackendCapabilityMap = Record<AIBackend, BackendCapabilities>;

export const A2ACommunicationMode = {
  DIRECT: 'direct',
  RELAY: 'relay',
} as const;
export type A2ACommunicationMode = (typeof A2ACommunicationMode)[keyof typeof A2ACommunicationMode];

export interface DelegateTaskRequest {
  fromAgentId: AgentId;
  toAgentId: AgentId;
  task: string;
  context?: string;
}

export interface DelegateTaskResult {
  fromAgentId: AgentId;
  toAgentId: AgentId;
  result: string;
  success: boolean;
  error?: string;
}
