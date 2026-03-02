import type { AgentId, Timestamp } from './base.ts';

interface CronWorkflowStep {
  agentId: AgentId;
  task: string;
}

export interface CronWorkflow {
  steps: CronWorkflowStep[];
  output: string;
}

export interface CronEntry {
  id: string;
  name: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  workflow: CronWorkflow;
  createdBy: string;
  createdAt: Timestamp;
}

export interface CronExecutionLog {
  cronId: string;
  executedAt: Timestamp;
  result: string;
  success: boolean;
  error?: string;
}

export interface CronEntryWithStatus extends CronEntry {
  nextRunAt: string | null;
  lastExecution: CronExecutionLog | null;
}
