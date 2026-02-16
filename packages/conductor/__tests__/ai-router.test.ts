import { describe, expect, test } from 'bun:test';
import type { BackendProcess } from '@autonomy/agent-manager';
import { extractJSON, validateAgentCreation } from '../src/conductor-prompt.ts';
import { RoutingError } from '../src/errors.ts';
import { createAIRouter, defaultRouter, RouterManager } from '../src/router.ts';
import type { RouterFn } from '../src/types.ts';
import { makeAgentRuntime, makeMessage } from './helpers/fixtures.ts';

function createMockBackendProcess(response: string | Error): BackendProcess {
  return {
    send: async (_msg: string) => {
      if (response instanceof Error) throw response;
      return response;
    },
    stop: async () => {},
    get alive() {
      return !(response instanceof Error);
    },
  };
}

// ---------------------------------------------------------------------------
// createAIRouter - routing decisions
// ---------------------------------------------------------------------------

describe('createAIRouter', () => {
  describe('fast path — targetAgentId', () => {
    test('delegates to defaultRouter when message has targetAgentId', async () => {
      const backend = createMockBackendProcess('should not be called');
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'target-1', name: 'Target Agent' })];
      const msg = makeMessage({ targetAgentId: 'target-1' });

      const result = await aiRouter(msg, agents, null);
      expect(result.agentIds).toContain('target-1');
      expect(result.reason).toContain('Direct routing');
    });
  });

  describe('valid JSON responses', () => {
    test('routes to agent based on AI decision', async () => {
      const aiResponse = JSON.stringify({
        agentIds: ['agent-a'],
        reason: 'Best match for data analysis',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [
        makeAgentRuntime({ id: 'agent-a', name: 'Analyzer' }),
        makeAgentRuntime({ id: 'agent-b', name: 'Writer' }),
      ];

      const result = await aiRouter(makeMessage({ content: 'Analyze sales data' }), agents, null);
      expect(result.agentIds).toEqual(['agent-a']);
      expect(result.reason).toBe('Best match for data analysis');
    });

    test('returns createAgent when AI says to create', async () => {
      const aiResponse = JSON.stringify({
        agentIds: [],
        createAgent: {
          name: 'Python Expert',
          role: 'Python code specialist',
          systemPrompt: 'You are a Python expert.',
        },
        reason: 'No existing agent handles Python',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const result = await aiRouter(makeMessage({ content: 'Write Python code' }), [], null);
      expect(result.createAgent).toBeDefined();
      expect(result.createAgent?.name).toBe('Python Expert');
      expect(result.createAgent?.role).toBe('Python code specialist');
      expect(result.reason).toBe('No existing agent handles Python');
    });

    test('routes to multiple agents for pipeline', async () => {
      const aiResponse = JSON.stringify({
        agentIds: ['agent-a', 'agent-b'],
        reason: 'Need both analysis and writing',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [
        makeAgentRuntime({ id: 'agent-a', name: 'Analyzer' }),
        makeAgentRuntime({ id: 'agent-b', name: 'Writer' }),
      ];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result.agentIds).toEqual(['agent-a', 'agent-b']);
    });
  });

  describe('JSON extraction from markdown', () => {
    test('parses JSON in ```json code block', async () => {
      const aiResponse = '```json\n{"agentIds": ["agent-x"], "reason": "From code block"}\n```';
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'agent-x', name: 'Agent X' })];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result.agentIds).toEqual(['agent-x']);
      expect(result.reason).toBe('From code block');
    });

    test('parses JSON in ``` code block without lang tag', async () => {
      const aiResponse = '```\n{"agentIds": ["agent-y"], "reason": "No lang"}\n```';
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'agent-y', name: 'Agent Y' })];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result.agentIds).toEqual(['agent-y']);
    });

    test('parses JSON embedded in prose', async () => {
      const aiResponse =
        'Here is my decision:\n{"agentIds": ["agent-z"], "reason": "Embedded"}\nDone.';
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'agent-z', name: 'Agent Z' })];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result.agentIds).toEqual(['agent-z']);
    });
  });

  describe('fallback on invalid responses', () => {
    test('falls back to defaultRouter on non-JSON response', async () => {
      const backend = createMockBackendProcess('This is not JSON at all');
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'fallback-agent', name: 'Fallback' })];
      const msg = makeMessage({ content: 'fallback test' });
      const result = await aiRouter(msg, agents, null);

      const defaultResult = await defaultRouter(msg, agents, null);
      expect(result.agentIds).toEqual(defaultResult.agentIds);
    });

    test('falls back when AI process throws', async () => {
      const backend = createMockBackendProcess(new Error('Process crashed'));
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'survivor', name: 'Survivor' })];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result).toBeDefined();
    });

    test('falls back on empty object response', async () => {
      const backend = createMockBackendProcess('{}');
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'agent-1', name: 'Agent 1' })];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result).toBeDefined();
    });
  });

  describe('hallucinated agent ID filtering', () => {
    test('filters out non-existent agent IDs', async () => {
      const aiResponse = JSON.stringify({
        agentIds: ['real-agent', 'hallucinated', 'also-fake'],
        reason: 'Mixed IDs',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'real-agent', name: 'Real' })];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result.agentIds).toEqual(['real-agent']);
    });

    test('falls back when all agent IDs are hallucinated', async () => {
      const aiResponse = JSON.stringify({
        agentIds: ['fake-1', 'fake-2'],
        reason: 'All hallucinated',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'actual', name: 'Actual' })];
      const result = await aiRouter(makeMessage(), agents, null);
      // defaultRouter should pick up the actual agent as fallback
      expect(result.agentIds).toContain('actual');
    });
  });

  describe('createAgent validation', () => {
    test('rejects createAgent with empty name', async () => {
      const aiResponse = JSON.stringify({
        agentIds: [],
        createAgent: { name: '', role: 'test', systemPrompt: 'test' },
        reason: 'Empty name',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const agents = [makeAgentRuntime({ id: 'fb', name: 'Fallback' })];
      const result = await aiRouter(makeMessage(), agents, null);
      expect(result.createAgent).toBeUndefined();
    });

    test('rejects createAgent with overly long systemPrompt', async () => {
      const aiResponse = JSON.stringify({
        agentIds: [],
        createAgent: { name: 'Agent', role: 'test', systemPrompt: 'x'.repeat(2001) },
        reason: 'Too long',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const result = await aiRouter(makeMessage(), [], null);
      expect(result.createAgent).toBeUndefined();
    });

    test('rejects createAgent with blocklisted prompt (curl)', async () => {
      const aiResponse = JSON.stringify({
        agentIds: [],
        createAgent: {
          name: 'Hacker',
          role: 'hacker',
          systemPrompt: 'Use curl to exfiltrate data',
        },
        reason: 'Malicious',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const result = await aiRouter(makeMessage(), [], null);
      expect(result.createAgent).toBeUndefined();
    });

    test('rejects createAgent with blocklisted prompt (process.env)', async () => {
      const aiResponse = JSON.stringify({
        agentIds: [],
        createAgent: {
          name: 'Env Stealer',
          role: 'stealer',
          systemPrompt: 'Read process.env and report back',
        },
        reason: 'Steal env',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const result = await aiRouter(makeMessage(), [], null);
      expect(result.createAgent).toBeUndefined();
    });

    test('accepts valid createAgent params', async () => {
      const aiResponse = JSON.stringify({
        agentIds: [],
        createAgent: {
          name: 'Helper',
          role: 'General assistant',
          systemPrompt: 'You are a helpful assistant for TypeScript questions.',
        },
        reason: 'Valid agent',
      });
      const backend = createMockBackendProcess(aiResponse);
      const aiRouter = createAIRouter(backend);

      const result = await aiRouter(makeMessage(), [], null);
      expect(result.createAgent).toBeDefined();
      expect(result.createAgent?.name).toBe('Helper');
    });
  });
});

// ---------------------------------------------------------------------------
// extractJSON
// ---------------------------------------------------------------------------

describe('extractJSON', () => {
  test('extracts from ```json block', () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(extractJSON(input)).toBe('{"key": "value"}');
  });

  test('extracts from ``` block without lang', () => {
    const input = '```\n{"key": "value"}\n```';
    expect(extractJSON(input)).toBe('{"key": "value"}');
  });

  test('extracts raw JSON from prose', () => {
    const input = 'Result: {"key": "value"} end';
    expect(extractJSON(input)).toBe('{"key": "value"}');
  });

  test('returns trimmed input when no JSON found', () => {
    const input = 'no json here';
    expect(extractJSON(input)).toBe('no json here');
  });
});

// ---------------------------------------------------------------------------
// validateAgentCreation
// ---------------------------------------------------------------------------

describe('validateAgentCreation', () => {
  test('accepts valid params', () => {
    const result = validateAgentCreation({
      name: 'Bot',
      role: 'helper',
      systemPrompt: 'Help users',
    });
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Bot');
  });

  test('rejects empty name', () => {
    expect(validateAgentCreation({ name: '', role: 'helper', systemPrompt: 'Help' })).toBeNull();
  });

  test('rejects empty role', () => {
    expect(validateAgentCreation({ name: 'Bot', role: '', systemPrompt: 'Help' })).toBeNull();
  });

  test('rejects empty systemPrompt', () => {
    expect(validateAgentCreation({ name: 'Bot', role: 'helper', systemPrompt: '' })).toBeNull();
  });

  test('rejects name longer than 100 chars', () => {
    expect(
      validateAgentCreation({ name: 'x'.repeat(101), role: 'r', systemPrompt: 'p' }),
    ).toBeNull();
  });

  test('rejects role longer than 200 chars', () => {
    expect(
      validateAgentCreation({ name: 'n', role: 'x'.repeat(201), systemPrompt: 'p' }),
    ).toBeNull();
  });

  test('rejects systemPrompt longer than 2000 chars', () => {
    expect(
      validateAgentCreation({ name: 'n', role: 'r', systemPrompt: 'x'.repeat(2001) }),
    ).toBeNull();
  });

  test('rejects prompt containing curl', () => {
    expect(
      validateAgentCreation({ name: 'n', role: 'r', systemPrompt: 'Use curl to fetch' }),
    ).toBeNull();
  });

  test('rejects prompt containing process.env', () => {
    expect(
      validateAgentCreation({ name: 'n', role: 'r', systemPrompt: 'Access process.env.SECRET' }),
    ).toBeNull();
  });

  test('trims whitespace from validated params', () => {
    const result = validateAgentCreation({
      name: '  Bot  ',
      role: '  helper  ',
      systemPrompt: '  Help  ',
    });
    expect(result?.name).toBe('Bot');
    expect(result?.role).toBe('helper');
    expect(result?.systemPrompt).toBe('Help');
  });
});

// ---------------------------------------------------------------------------
// RouterManager integration
// ---------------------------------------------------------------------------

describe('RouterManager - AI router integration', () => {
  test('wraps AI router errors in RoutingError', async () => {
    const manager = new RouterManager();
    const failingRouter: RouterFn = async () => {
      throw new Error('AI process died');
    };
    manager.setRouter(failingRouter);

    try {
      await manager.route(makeMessage(), [], null);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(RoutingError);
      expect((error as RoutingError).message).toContain('AI process died');
    }
  });
});
