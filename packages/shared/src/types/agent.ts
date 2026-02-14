import type { AgentId, AgentOwner, AgentStatus, Timestamp } from './base.ts';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  tools: string[];
  canModifyFiles: boolean;
  canDelegateToAgents: boolean;
  maxConcurrent: number;
  owner: AgentOwner;
  persistent: boolean;
  createdBy: string;
  createdAt: Timestamp;
  systemPrompt: string;
}

export interface AgentRegistryEntry {
  id: AgentId;
  file: string;
  owner: AgentOwner;
  autoStart: boolean;
}

export interface AgentRegistry {
  agents: AgentRegistryEntry[];
}

export interface AgentRuntimeInfo {
  id: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  owner: AgentOwner;
  persistent: boolean;
  createdAt: Timestamp;
}
