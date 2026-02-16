import type { AgentId } from './base.ts';

export const DebugEventCategory = {
  CONDUCTOR: 'conductor',
  AGENT: 'agent',
  MEMORY: 'memory',
  WEBSOCKET: 'websocket',
  SYSTEM: 'system',
} as const;
export type DebugEventCategory = (typeof DebugEventCategory)[keyof typeof DebugEventCategory];

export const DebugEventLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;
export type DebugEventLevel = (typeof DebugEventLevel)[keyof typeof DebugEventLevel];

export const DEBUG_LEVEL_ORDER: Record<DebugEventLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface DebugEvent {
  id: string;
  timestamp: string; // ISO
  category: DebugEventCategory;
  level: DebugEventLevel;
  source: string; // e.g. "conductor.router", "agent-pool.create"
  message: string;
  data?: Record<string, unknown>;
  agentId?: AgentId;
  durationMs?: number;
}
