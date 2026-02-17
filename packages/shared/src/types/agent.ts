import type { AIBackend } from './a2a.ts';
import type { AgentId, AgentOwner, AgentStatus, Timestamp } from './base.ts';
import type { AgentLifecycle } from './session.ts';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  tools: string[];
  canModifyFiles: boolean;
  canDelegateToAgents: boolean;
  maxConcurrent: number;
  owner: AgentOwner;
  /** @deprecated Use `lifecycle` field. Kept for backward compat; `lifecycle` takes precedence. */
  persistent: boolean;
  createdBy: string;
  createdAt: Timestamp;
  systemPrompt: string;
  /** Canonical lifecycle: 'persistent' (stateful, sessions) or 'ephemeral' (task-scoped). Takes precedence over `persistent`. */
  lifecycle?: AgentLifecycle;
  /** Parent agent ID for hierarchical delegation. */
  parentId?: AgentId;
  /** Session UUID for conversation persistence via --resume. */
  sessionId?: string;
  /** Department namespace for memory scoping (e.g., 'eng', 'mktg'). */
  department?: string;
  /** Which AI backend powers this agent (defaults to platform default). */
  backend?: AIBackend;
  /** Model override for this agent's backend. */
  backendModel?: string;
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
  /** Agent lifecycle type. */
  lifecycle?: AgentLifecycle;
  /** Active session UUID if persistent. */
  sessionId?: string;
}
