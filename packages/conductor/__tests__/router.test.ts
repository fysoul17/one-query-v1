import { describe, expect, test } from 'bun:test';
import { AgentStatus } from '@autonomy/shared';
import { RoutingError } from '../src/errors.ts';
import { defaultRouter, RouterManager } from '../src/router.ts';
import type { RouterFn } from '../src/types.ts';
import { makeAgentRuntime, makeMessage } from './helpers/fixtures.ts';

describe('defaultRouter', () => {
  test('routes to targeted agent when targetAgentId is set', async () => {
    const agents = [
      makeAgentRuntime({ id: 'a1', name: 'Alpha' }),
      makeAgentRuntime({ id: 'a2', name: 'Beta' }),
    ];
    const message = makeMessage({ targetAgentId: 'a2' });

    const result = await defaultRouter(message, agents, null);
    expect(result.agentIds).toEqual(['a2']);
    expect(result.reason).toContain('Direct routing');
  });

  test('returns empty when targeted agent not found', async () => {
    const agents = [makeAgentRuntime({ id: 'a1', name: 'Alpha' })];
    const message = makeMessage({ targetAgentId: 'nonexistent' });

    const result = await defaultRouter(message, agents, null);
    expect(result.agentIds).toEqual([]);
    expect(result.reason).toContain('not found');
  });

  test('returns empty when no available agents', async () => {
    const agents = [
      makeAgentRuntime({ id: 'a1', status: AgentStatus.STOPPED }),
      makeAgentRuntime({ id: 'a2', status: AgentStatus.ERROR }),
    ];
    const message = makeMessage({ content: 'anything' });

    const result = await defaultRouter(message, agents, null);
    expect(result.agentIds).toEqual([]);
    expect(result.reason).toContain('No available');
  });

  test('scores agents by keyword overlap with message', async () => {
    const agents = [
      makeAgentRuntime({ id: 'a1', name: 'Data Analyzer', role: 'data analysis' }),
      makeAgentRuntime({ id: 'a2', name: 'Code Writer', role: 'code generation' }),
    ];
    const message = makeMessage({ content: 'Please analyze this data for me' });

    const result = await defaultRouter(message, agents, null);
    expect(result.agentIds[0]).toBe('a1');
    expect(result.reason).toContain('Keyword routing');
  });

  test('returns multiple agents when multiple match', async () => {
    const agents = [
      makeAgentRuntime({ id: 'a1', name: 'Data Coder', role: 'data code' }),
      makeAgentRuntime({ id: 'a2', name: 'Code Helper', role: 'code helper' }),
    ];
    const message = makeMessage({ content: 'help me code something' });

    const result = await defaultRouter(message, agents, null);
    expect(result.agentIds.length).toBeGreaterThanOrEqual(1);
  });

  test('falls back to first available when no keyword match', async () => {
    const agents = [
      makeAgentRuntime({ id: 'a1', name: 'Alpha', role: 'general' }),
      makeAgentRuntime({ id: 'a2', name: 'Beta', role: 'specialist' }),
    ];
    const message = makeMessage({ content: 'xyz123 completely unrelated' });

    const result = await defaultRouter(message, agents, null);
    expect(result.agentIds.length).toBe(1);
    expect(result.reason).toContain('Fallback');
  });

  test('excludes stopped/error agents from scoring', async () => {
    const agents = [
      makeAgentRuntime({
        id: 'a1',
        name: 'Data Analyzer',
        role: 'data',
        status: AgentStatus.STOPPED,
      }),
      makeAgentRuntime({ id: 'a2', name: 'General Helper', role: 'helper' }),
    ];
    const message = makeMessage({ content: 'analyze data' });

    const result = await defaultRouter(message, agents, null);
    // a1 is stopped, so a2 should be the only option
    expect(result.agentIds).not.toContain('a1');
  });

  test('handles empty agents list', async () => {
    const result = await defaultRouter(makeMessage(), [], null);
    expect(result.agentIds).toEqual([]);
  });
});

describe('RouterManager', () => {
  test('uses defaultRouter by default', async () => {
    const manager = new RouterManager();
    const agents = [makeAgentRuntime({ id: 'a1', name: 'Alpha' })];
    const message = makeMessage({ targetAgentId: 'a1' });

    const result = await manager.route(message, agents, null);
    expect(result.agentIds).toEqual(['a1']);
  });

  test('allows setting a custom router', async () => {
    const manager = new RouterManager();
    const customRouter: RouterFn = async () => ({
      agentIds: ['custom-agent'],
      reason: 'Custom routing',
    });

    manager.setRouter(customRouter);
    const result = await manager.route(makeMessage(), [], null);
    expect(result.agentIds).toEqual(['custom-agent']);
    expect(result.reason).toBe('Custom routing');
  });

  test('resetRouter restores defaultRouter', async () => {
    const manager = new RouterManager();
    const customRouter: RouterFn = async () => ({
      agentIds: ['custom'],
      reason: 'Custom',
    });

    manager.setRouter(customRouter);
    manager.resetRouter();

    const agents = [makeAgentRuntime({ id: 'a1', name: 'Alpha' })];
    const message = makeMessage({ targetAgentId: 'a1' });
    const result = await manager.route(message, agents, null);
    expect(result.agentIds).toEqual(['a1']);
  });

  test('wraps router errors in RoutingError', async () => {
    const manager = new RouterManager();
    manager.setRouter(async () => {
      throw new Error('Router crashed');
    });

    try {
      await manager.route(makeMessage(), [], null);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(RoutingError);
      expect((error as RoutingError).message).toContain('Router crashed');
    }
  });

  test('wraps non-Error throws in RoutingError', async () => {
    const manager = new RouterManager();
    manager.setRouter(async () => {
      throw 'string error';
    });

    try {
      await manager.route(makeMessage(), [], null);
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(RoutingError);
      expect((error as RoutingError).message).toContain('string error');
    }
  });
});
