import {
  type AgentDefinition,
  AgentOwner,
  type AgentRuntimeInfo,
  AgentStatus,
} from '@autonomy/shared';
import type { IncomingMessage } from '../../src/types.ts';

let counter = 0;

export function makeAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
  counter++;
  return {
    id: `agent-${counter}`,
    name: `Agent ${counter}`,
    role: 'general',
    tools: [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: AgentOwner.CONDUCTOR,
    persistent: false,
    createdBy: 'conductor',
    createdAt: new Date().toISOString(),
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}

export function makeAgentRuntime(overrides?: Partial<AgentRuntimeInfo>): AgentRuntimeInfo {
  counter++;
  return {
    id: `agent-${counter}`,
    name: `Agent ${counter}`,
    role: 'general',
    status: AgentStatus.IDLE,
    owner: AgentOwner.CONDUCTOR,
    persistent: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeMessage(overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    content: 'Hello, this is a test message',
    senderId: 'user-1',
    senderName: 'Test User',
    ...overrides,
  };
}
