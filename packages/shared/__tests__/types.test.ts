import { describe, expect, test } from 'bun:test';
import type {
  ActivityEntry,
  AgentDefinition,
  AgentRegistryEntry,
  CronConfig,
  MemoryEntry,
  PlatformConfig,
  WSClientMessage,
  WSServerMessage,
} from '../src/index.ts';

describe('@autonomy/shared type definitions', () => {
  test('AgentDefinition type is structurally valid', () => {
    const agent: AgentDefinition = {
      id: 'test-agent',
      name: 'Test Agent',
      role: 'tester',
      tools: ['Read', 'Grep'],
      canModifyFiles: false,
      canDelegateToAgents: false,
      maxConcurrent: 1,
      owner: 'user',
      persistent: true,
      createdBy: 'user',
      createdAt: new Date().toISOString(),
      systemPrompt: 'You are a test agent.',
    };
    expect(agent.id).toBe('test-agent');
  });

  test('AgentRegistryEntry type is structurally valid', () => {
    const entry: AgentRegistryEntry = {
      id: 'agent-1',
      file: 'agent-1.md',
      owner: 'user',
      autoStart: true,
    };
    expect(entry.id).toBe('agent-1');
  });

  test('CronConfig type is structurally valid', () => {
    const cron: CronConfig = {
      version: 1,
      crons: [
        {
          id: 'cron-1',
          name: 'Daily Report',
          schedule: '0 9 * * *',
          timezone: 'UTC',
          enabled: true,
          workflow: {
            steps: [{ agentId: 'reporter', task: 'Generate daily report' }],
            output: 'channel:telegram',
          },
          createdBy: 'user',
          createdAt: new Date().toISOString(),
        },
      ],
    };
    expect(cron.version).toBe(1);
    expect(cron.crons).toHaveLength(1);
  });

  test('PlatformConfig type is structurally valid', () => {
    const config: PlatformConfig = {
      backend: 'claude',
      apiKeys: { anthropic: 'test-key-not-real' },
      defaultModel: 'claude-opus-4-6',
      idleTimeoutMs: 300000,
      maxAgents: 10,
      memory: {
        vectorProvider: 'lancedb',
      },
    };
    expect(config.backend).toBe('claude');
  });

  test('WSClientMessage type is structurally valid', () => {
    const msg: WSClientMessage = {
      type: 'message',
      content: 'Hello',
      targetAgent: 'agent-1',
    };
    expect(msg.type).toBe('message');
  });

  test('WSServerMessage discriminated union works', () => {
    const chunk: WSServerMessage = {
      type: 'chunk',
      content: 'Hello',
      agentId: 'agent-1',
    };
    expect(chunk.type).toBe('chunk');

    const complete: WSServerMessage = { type: 'complete' };
    expect(complete.type).toBe('complete');

    const error: WSServerMessage = { type: 'error', message: 'Something went wrong' };
    expect(error.type).toBe('error');
  });

  test('MemoryEntry type is structurally valid', () => {
    const entry: MemoryEntry = {
      id: 'mem-1',
      content: 'Test memory',
      type: 'long-term',
      metadata: { source: 'test' },
      createdAt: new Date().toISOString(),
    };
    expect(entry.type).toBe('long-term');
    expect(entry.metadata).toEqual({ source: 'test' });
  });

  test('MemoryEntry supports v2 optional fields', () => {
    const entry: MemoryEntry = {
      id: 'mem-2',
      content: 'Episodic memory',
      type: 'episodic',
      metadata: {},
      createdAt: new Date().toISOString(),
      importance: 8,
      accessCount: 3,
      source: 'conductor',
      contentHash: 'abc123',
    };
    expect(entry.type).toBe('episodic');
    expect(entry.importance).toBe(8);
  });

  test('ActivityEntry type is structurally valid', () => {
    const entry: ActivityEntry = {
      id: 'act-1',
      timestamp: new Date().toISOString(),
      type: 'message',
      details: 'User sent a message',
    };
    expect(entry.type).toBe('message');
  });
});
