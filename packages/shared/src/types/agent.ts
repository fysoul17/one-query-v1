import type { AIBackend } from './a2a.ts';
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
  /** Session UUID for conversation persistence via --resume. */
  sessionId?: string;
  /** Which AI backend powers this agent (defaults to platform default). */
  backend?: AIBackend;
  /** Model override for this agent's backend. */
  backendModel?: string;
}

export interface AgentStoreInterface {
  save(definition: AgentDefinition): void;
  update(id: AgentId, definition: AgentDefinition): void;
  delete(id: AgentId): void;
  getById(id: AgentId): AgentDefinition | null;
  list(): AgentDefinition[];
  upsertSeed(definition: AgentDefinition): boolean;
}

export interface AgentRuntimeInfo {
  id: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  owner: AgentOwner;
  persistent: boolean;
  createdAt: Timestamp;
  /** Active session UUID if persistent. */
  sessionId?: string;
  /** Which AI backend powers this agent. */
  backend?: AIBackend;
}
