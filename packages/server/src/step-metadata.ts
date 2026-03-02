// step-metadata.ts — Types and functions for accumulating and persisting
// pipeline phases and agent tool activity during streaming responses.

import { ConductorEventType } from '@autonomy/conductor';
import type { ConductorDebugPayload } from '@autonomy/shared';

/** Max bytes of accumulated tool input to persist per tool call. */
export const MAX_PERSISTED_INPUT_BYTES = 2048;

/**
 * Default phase messages for pipeline persistence.
 * Also used by sendConductorStatus() in websocket.ts to avoid duplicating
 * the event-type → default-message mapping.
 */
export const PHASE_MESSAGES: Record<string, string> = {
  [ConductorEventType.QUEUED]: 'Message queued...',
  [ConductorEventType.DELEGATING]: 'Delegating to agent...',
  [ConductorEventType.MEMORY_SEARCH]: 'Searching memory...',
  [ConductorEventType.CONTEXT_INJECT]: 'Loading conversation history...',
  [ConductorEventType.MEMORY_STORE]: 'Storing conversation...',
  [ConductorEventType.DELEGATION_COMPLETE]: 'Delegation complete',
  [ConductorEventType.RESPONDING]: 'Conductor is responding...',
};

export interface PersistedPipelinePhase {
  phase: string;
  message: string;
  timestamp: number;
  durationMs?: number;
  debug?: ConductorDebugPayload;
}

export interface PersistedToolCall {
  toolId: string;
  toolName: string;
  accumulatedInput: string;
  status: 'complete' | 'streaming';
  durationMs?: number;
  startedAt: number;
  completedAt?: number;
}

export interface PersistedThinking {
  content: string;
  timestamp: number;
}

export interface PersistedAgentActivity {
  agentId: string;
  agentName?: string;
  toolCalls: PersistedToolCall[];
  thinkingBlocks: PersistedThinking[];
}

export interface PersistedActivityFeed {
  agents: PersistedAgentActivity[];
  totalSteps: number;
  totalDurationMs: number;
  isActive: boolean;
}

/** Metadata shape persisted on assistant messages to retain step/debug cards. */
export interface StepMetadata {
  pipeline?: PersistedPipelinePhase[];
  activityFeed?: PersistedActivityFeed;
}

export interface StreamState {
  accumulatedContent: string;
  completeSent: boolean;
  errorSent: boolean;
  /** Pipeline phases accumulated from conductor_status events. */
  pipelinePhases: PersistedPipelinePhase[];
  /** Agent activities accumulated from agent_step events. */
  agentActivities: Map<string, PersistedAgentActivity>;
  /** Maps toolId → agentId for routing tool_input/tool_complete. */
  toolToAgent: Map<string, string>;
}

/** Accumulate an agent step event into the StreamState for later persistence. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: switch over event types with nested tool lookups
export function accumulateAgentStep(
  state: StreamState,
  event: {
    type: string;
    toolId?: string;
    toolName?: string;
    inputDelta?: string;
    content?: string;
    durationMs?: number;
  },
  agentId: string,
  agentDisplayName?: string,
): void {
  function getOrCreateAgent(id: string): PersistedAgentActivity {
    let agent = state.agentActivities.get(id);
    if (!agent) {
      agent = { agentId: id, agentName: agentDisplayName, toolCalls: [], thinkingBlocks: [] };
      state.agentActivities.set(id, agent);
    }
    return agent;
  }

  switch (event.type) {
    case 'tool_start': {
      if (!event.toolId) return;
      const agent = getOrCreateAgent(agentId);
      agent.toolCalls.push({
        toolId: event.toolId,
        toolName: event.toolName ?? 'unknown',
        accumulatedInput: '',
        status: 'streaming',
        startedAt: Date.now(),
      });
      state.toolToAgent.set(event.toolId, agentId);
      break;
    }
    case 'tool_input': {
      if (!event.toolId || !event.inputDelta) return;
      const ownerAgentId = state.toolToAgent.get(event.toolId);
      if (!ownerAgentId) return;
      const agent = state.agentActivities.get(ownerAgentId);
      const tool = agent?.toolCalls.find((tc) => tc.toolId === event.toolId);
      if (tool && tool.accumulatedInput.length < MAX_PERSISTED_INPUT_BYTES) {
        tool.accumulatedInput += event.inputDelta;
        if (tool.accumulatedInput.length > MAX_PERSISTED_INPUT_BYTES) {
          tool.accumulatedInput = `${tool.accumulatedInput.slice(0, MAX_PERSISTED_INPUT_BYTES)}\n[truncated]`;
        }
      }
      break;
    }
    case 'tool_complete': {
      if (!event.toolId) return;
      const ownerAgentId = state.toolToAgent.get(event.toolId);
      if (!ownerAgentId) return;
      const agent = state.agentActivities.get(ownerAgentId);
      const tool = agent?.toolCalls.find((tc) => tc.toolId === event.toolId);
      if (tool) {
        tool.status = 'complete';
        tool.durationMs = event.durationMs;
        tool.completedAt = Date.now();
      }
      state.toolToAgent.delete(event.toolId);
      break;
    }
    case 'thinking': {
      const agent = getOrCreateAgent(agentId);
      agent.thinkingBlocks.push({ content: event.content ?? '', timestamp: Date.now() });
      break;
    }
  }
}

/** Build the metadata object containing pipeline and activity data for persistence. */
export function buildStepMetadata(state: StreamState): StepMetadata | undefined {
  const hasPipeline = state.pipelinePhases.length > 0;
  const hasActivity = state.agentActivities.size > 0;
  if (!hasPipeline && !hasActivity) return undefined;

  const metadata: StepMetadata = {};

  if (hasPipeline) {
    metadata.pipeline = state.pipelinePhases;
  }

  if (hasActivity) {
    const agents = Array.from(state.agentActivities.values());
    let totalDurationMs = 0;
    let totalSteps = 0;
    for (const agent of agents) {
      totalSteps += agent.toolCalls.length + agent.thinkingBlocks.length;
      for (const tc of agent.toolCalls) {
        totalDurationMs += tc.durationMs ?? 0;
      }
    }
    metadata.activityFeed = {
      agents,
      totalSteps,
      totalDurationMs,
      isActive: false, // always false when persisting (response is complete)
    };
  }

  return metadata;
}
