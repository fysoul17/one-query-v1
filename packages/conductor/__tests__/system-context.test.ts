import { describe, expect, test } from 'bun:test';
import { buildSystemContextPreamble, type SystemContextConfig } from '../src/system-context.ts';
import { makeAgentRuntime } from './helpers/fixtures.ts';

describe('buildSystemContextPreamble', () => {
  test('wraps output in <system-context> tags', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).toStartWith('<system-context>');
    expect(result).toEndWith('</system-context>');
  });

  test('includes platform identity', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('agent-forge');
    expect(result).toContain('orchestration platform');
  });

  test('includes memory rules when connected', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('pyx-memory');
    expect(result).toContain('Do NOT write files');
  });

  test('includes disabled memory rules when not connected', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: false };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('Memory is NOT connected');
    expect(result).toContain('Do NOT claim to store or search memory');
    expect(result).not.toContain('Do NOT write files');
  });

  test('shows "no agents" when list is empty', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('No other agents are currently running');
  });

  test('lists active agents with id, name, role, status', () => {
    const agents = [
      makeAgentRuntime({ id: 'r1', name: 'Researcher', role: 'research', status: 'idle' as never }),
      makeAgentRuntime({ id: 'w1', name: 'Writer', role: 'writing', status: 'busy' as never }),
    ];
    const config: SystemContextConfig = { agents, cronEnabled: false, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('Researcher (r1): research [idle]');
    expect(result).toContain('Writer (w1): writing [busy]');
  });

  test('includes search_memory action when memory connected', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('create_agent');
    expect(result).toContain('search_memory');
  });

  test('excludes search_memory action when memory not connected', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: false };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('create_agent');
    expect(result).not.toContain('type="search_memory"');
  });

  test('excludes cron action when cronEnabled is false', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: false, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).not.toContain('create_cron');
  });

  test('includes cron action when cronEnabled is true', () => {
    const config: SystemContextConfig = { agents: [], cronEnabled: true, memoryConnected: true };
    const result = buildSystemContextPreamble(config);
    expect(result).toContain('create_cron');
    expect(result).toContain('scheduled task');
  });
});
