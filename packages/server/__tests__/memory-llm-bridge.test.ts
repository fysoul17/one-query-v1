import { beforeEach, describe, expect, test } from 'bun:test';
import { MockBackend } from '@autonomy/agent-manager/__tests__/helpers/mock-backend.ts';
import { createMemoryLLMCallback } from '../src/memory-llm-bridge.ts';

describe('createMemoryLLMCallback()', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = new MockBackend();
  });

  test('calls backend.spawn with correct config', async () => {
    await createMemoryLLMCallback(backend);

    expect(backend.spawnCalls.length).toBe(1);
    const config = backend.spawnCalls[0];
    expect(config.agentId).toBe('memory-lifecycle');
    expect(config.skipPermissions).toBe(true);
    expect(config.sessionPersistence).toBe(false);
    expect(config.systemPrompt).toContain('memory management');
  });

  test('returned callback sends prompt to spawned process', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    backend = new MockBackend('claude' as any, undefined as any, ['LLM result']);
    const handle = await createMemoryLLMCallback(backend);

    const result = await handle.callback('Extract facts from this text');

    expect(result).toBe('LLM result');
    expect(backend.spawnedProcesses[0].sentMessages).toEqual(['Extract facts from this text']);
  });

  test('throws when backend.spawn fails', async () => {
    backend.spawnError = new Error('spawn failed');

    await expect(createMemoryLLMCallback(backend)).rejects.toThrow('spawn failed');
  });

  test('callback propagates process.send errors', async () => {
    backend.processErrorToThrow = new Error('send failed');
    const handle = await createMemoryLLMCallback(backend);

    await expect(handle.callback('test')).rejects.toThrow('send failed');
  });

  test('shutdown stops the spawned process', async () => {
    const handle = await createMemoryLLMCallback(backend);
    expect(backend.spawnedProcesses[0].alive).toBe(true);

    await handle.shutdown();

    expect(backend.spawnedProcesses[0].alive).toBe(false);
  });
});
