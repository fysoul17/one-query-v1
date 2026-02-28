import { afterEach, describe, expect, mock, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { PiBackend } from '../../src/backends/pi.ts';

describe('PiBackend', () => {
  const backend = new PiBackend();

  afterEach(() => {
    delete process.env.PI_API_KEY;
    delete process.env.PI_MODEL;
    mock.restore();
  });

  test('has correct name and capabilities', () => {
    expect(backend.name).toBe(AIBackend.PI);
    expect(backend.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.PI]);
  });

  test('capabilities reflect Pi features', () => {
    expect(backend.capabilities.customTools).toBe(false);
    expect(backend.capabilities.streaming).toBe(true);
    expect(backend.capabilities.sessionPersistence).toBe(true);
    expect(backend.capabilities.fileAccess).toBe(false);
  });

  test('getConfigOptions returns model option', () => {
    const options = backend.getConfigOptions();
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe('model');
    expect(options[0].values).toContain('openai/gpt-4.1');
    expect(options[0].values).toContain('anthropic/claude-sonnet');
  });

  test('getConfigOptions uses PI_MODEL env when set', () => {
    process.env.PI_MODEL = 'custom/model';
    const freshBackend = new PiBackend();
    const options = freshBackend.getConfigOptions();
    expect(options[0].defaultValue).toBe('custom/model');
  });

  describe('getStatus()', () => {
    test('reports unavailable when CLI not found', async () => {
      const originalWhich = Bun.which;
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      try {
        const status = await backend.getStatus();
        expect(status.available).toBe(false);
        expect(status.configured).toBe(false);
        expect(status.error).toBe('pi CLI not found on PATH');
      } finally {
        // @ts-expect-error — restoring Bun.which mock
        Bun.which = originalWhich;
      }
    });

    test('reports configured when PI_API_KEY is set and CLI available', async () => {
      const originalWhich = Bun.which;
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/bin/pi');
      process.env.PI_API_KEY = 'pi-test-key-123456789012';
      try {
        const status = await backend.getStatus();
        expect(status.authenticated).toBe(true);
        expect(status.authMode).toBe('api_key');
        expect(status.apiKeyMasked).toBe('...9012');
        expect(status.configured).toBe(true);
      } finally {
        // @ts-expect-error — restoring Bun.which mock
        Bun.which = originalWhich;
      }
    });

    test('reports not configured when no API key', async () => {
      const originalWhich = Bun.which;
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => '/usr/bin/pi');
      try {
        const status = await backend.getStatus();
        expect(status.configured).toBe(false);
        expect(status.authMode).toBe('none');
      } finally {
        // @ts-expect-error — restoring Bun.which mock
        Bun.which = originalWhich;
      }
    });
  });

  test('spawn returns a process', async () => {
    const proc = await backend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'You are a test agent',
    });
    expect(proc).toBeDefined();
    expect(proc.alive).toBe(true);
    await proc.stop();
    expect(proc.alive).toBe(false);
  });

  test('process nativeSessionId is undefined (implicit session via RPC)', async () => {
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
});
