/** Agent lifecycle: persistent agents have sessions/soul, ephemeral agents are task-scoped. */
export const AgentLifecycle = {
  PERSISTENT: 'persistent',
  EPHEMERAL: 'ephemeral',
} as const;
export type AgentLifecycle = (typeof AgentLifecycle)[keyof typeof AgentLifecycle];

/** Session configuration for agents and the conductor. */
export interface SessionConfig {
  /** Session UUID for --session-id / --resume. */
  sessionId?: string;
  /** Whether to persist session to disk. Default: true. False = --no-session-persistence. */
  sessionPersistence?: boolean;
}

/**
 * Derive the canonical lifecycle from an agent's fields.
 * `lifecycle` takes precedence over `persistent` (which is kept for backward compat).
 */
export function deriveLifecycle(agent: {
  lifecycle?: AgentLifecycle;
  persistent: boolean;
}): AgentLifecycle {
  return (
    agent.lifecycle ?? (agent.persistent ? AgentLifecycle.PERSISTENT : AgentLifecycle.EPHEMERAL)
  );
}

/** Whether an agent is persistent (lifecycle-first, falls back to persistent flag). */
export function isAgentPersistent(agent: {
  lifecycle?: AgentLifecycle;
  persistent: boolean;
}): boolean {
  return deriveLifecycle(agent) === AgentLifecycle.PERSISTENT;
}
