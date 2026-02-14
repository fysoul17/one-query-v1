/** ISO 8601 timestamp string */
export type Timestamp = string;

/** Unique agent identifier */
export type AgentId = string;

export const AgentOwner = {
  USER: 'user',
  CONDUCTOR: 'conductor',
  SYSTEM: 'system',
} as const;
export type AgentOwner = (typeof AgentOwner)[keyof typeof AgentOwner];

export const AgentStatus = {
  ACTIVE: 'active',
  IDLE: 'idle',
  BUSY: 'busy',
  STOPPED: 'stopped',
  ERROR: 'error',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];
