import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { OllamaBackend } from '../../src/backends/ollama.ts';

describe('OllamaBackend', () => {
  const backend = new OllamaBackend();

  afterEach(() => {
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
    mock.restore();
  });

  test('has correct name and capabilities', () => {
    expect(backend.name).toBe(AIBackend.OLLAMA);
    expect(backend.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.OLLAMA]);
  });

  test('capabilities reflect Ollama features', () => {
    expect(backend.capabilities.customTools).toBe(false);
    expect(backend.capabilities.streaming).toBe(true);
    expect(backend.capabilities.sessionPersistence).toBe(false);
    expect(backend.capabilities.fileAccess).toBe(false);
  });

  test('getConfigOptions returns model option', () => {
    const options = backend.getConfigOptions();
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe('model');
    expect(options[0].values).toContain('llama3.2');
    expect(options[0].values).toContain('mistral');
    expect(options[0].defaultValue).toBe('llama3.2');
  });

  test('getConfigOptions uses OLLAMA_MODEL env when set', () => {
    process.env.OLLAMA_MODEL = 'custom-model';
    const freshBackend = new OllamaBackend();
    const options = freshBackend.getConfigOptions();
    expect(options[0].defaultValue).toBe('custom-model');
  });

  describe('getStatus()', () => {
    test('reports unavailable when Ollama is not reachable', async () => {
      // Use a port that won't be listening
      process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:19999';
      const freshBackend = new OllamaBackend();
      const status = await freshBackend.getStatus();
      expect(status.available).toBe(false);
      expect(status.configured).toBe(false);
      expect(status.authenticated).toBe(true); // Ollama is always "authenticated" (local)
      expect(status.authMode).toBe('none');
      expect(status.error).toContain('not reachable');
    });

    test('reports correct name and capabilities in status', async () => {
      process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:19999';
      const freshBackend = new OllamaBackend();
      const status = await freshBackend.getStatus();
      expect(status.name).toBe(AIBackend.OLLAMA);
      expect(status.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.OLLAMA]);
    });
  });

  test('spawn returns a live process', async () => {
    const proc = await backend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'You are a test agent',
    });
    expect(proc).toBeDefined();
    expect(proc.alive).toBe(true);
    await proc.stop();
    expect(proc.alive).toBe(false);
  });

  test('process nativeSessionId is undefined', async () => {
    const proc = await backend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'Test',
    });
    expect(proc.nativeSessionId).toBeUndefined();
    await proc.stop();
  });

  test('process send throws when not alive', async () => {
    const proc = await backend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'Test',
    });
    await proc.stop();
    expect(proc.alive).toBe(false);
    await expect(proc.send('hello')).rejects.toThrow('not alive');
  });

  test('process sendStreaming yields error when not alive', async () => {
    const proc = await backend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'Test',
    });
    await proc.stop();

    const events = [];
    // biome-ignore lint/style/noNonNullAssertion: test assertion after spawn guarantees sendStreaming exists
    for await (const event of proc.sendStreaming!('hello')) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  test('process sendStreaming yields error when aborted', async () => {
    const proc = await backend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'Test',
    });

    const abortController = new AbortController();
    abortController.abort();

    const events = [];
    // biome-ignore lint/style/noNonNullAssertion: test assertion after spawn guarantees sendStreaming exists
    for await (const event of proc.sendStreaming!('hello', abortController.signal)) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].error).toBe('Aborted');
    await proc.stop();
  });

  test('process sendStreaming yields connection error for unreachable host', async () => {
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:19999';
    const freshBackend = new OllamaBackend();
    const proc = await freshBackend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'Test',
    });

    const events = [];
    // biome-ignore lint/style/noNonNullAssertion: test assertion after spawn guarantees sendStreaming exists
    for await (const event of proc.sendStreaming!('hello')) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error).toContain('Failed to connect');
    await proc.stop();
  });

  test('logout is a no-op', async () => {
    // Ollama is local — logout should not throw
    await expect(backend.logout()).resolves.toBeUndefined();
  });
});
