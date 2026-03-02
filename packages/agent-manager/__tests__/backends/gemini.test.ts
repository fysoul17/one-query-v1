import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { GeminiBackend } from '../../src/backends/gemini.ts';

describe('GeminiBackend', () => {
  let backend: GeminiBackend;
  let originalWhich: typeof Bun.which;

  beforeEach(() => {
    backend = new GeminiBackend();
    originalWhich = Bun.which;
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    // @ts-expect-error — restoring Bun.which mock
    Bun.which = originalWhich;
  });

  test('has correct name and capabilities', () => {
    expect(backend.name).toBe(AIBackend.GEMINI);
    expect(backend.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.GEMINI]);
  });

  test('getConfigOptions returns model option', () => {
    const options = backend.getConfigOptions();
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe('model');
    expect(options[0].cliFlag).toBe('--model');
    expect(options[0].values).toContain('gemini-2.5-pro');
  });

  describe('getStatus()', () => {
    test('reports unavailable when CLI not found', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      const status = await backend.getStatus();
      expect(status.available).toBe(false);
      expect(status.error).toBe('gemini CLI not found on PATH');
      expect(status.configured).toBe(false);
    });

    test('reports configured when GEMINI_API_KEY is set', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyA-test-key-1234';
      const status = await backend.getStatus();
      expect(status.authenticated).toBe(true);
      expect(status.authMode).toBe('api_key');
      expect(status.apiKeyMasked).toBe('...1234');
    });

    test('reports configured when GOOGLE_API_KEY is set', async () => {
      process.env.GOOGLE_API_KEY = 'AIzaSyA-test-key-5678';
      const status = await backend.getStatus();
      expect(status.authenticated).toBe(true);
      expect(status.authMode).toBe('api_key');
    });

    test('reports not configured when no API key and no CLI auth', async () => {
      // @ts-expect-error — mocking Bun.which for testing
      Bun.which = mock(() => null);
      const status = await backend.getStatus();
      expect(status.configured).toBe(false);
      expect(status.authMode).toBe('none');
    });
  });

  test('spawn returns a process', async () => {
    const process = await backend.spawn({
      agentId: 'test-agent',
      systemPrompt: 'You are a test agent',
    });
    expect(process).toBeDefined();
    expect(process.alive).toBe(true);
    await process.stop();
    expect(process.alive).toBe(false);
  });
});
