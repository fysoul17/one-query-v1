import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { CodexBackend } from '../../src/backends/codex.ts';

describe('CodexBackend', () => {
  let backend: CodexBackend;
  let originalWhich: typeof Bun.which;

  beforeEach(() => {
    backend = new CodexBackend();
    originalWhich = Bun.which;
  });

  afterEach(() => {
    // Clean up env overrides
    delete process.env.CODEX_API_KEY;
    delete process.env.OPENAI_API_KEY;
    // @ts-expect-error — restoring Bun.which mock
    Bun.which = originalWhich;
  });

  test('has correct name and capabilities', () => {
    expect(backend.name).toBe(AIBackend.CODEX);
    expect(backend.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.CODEX]);
  });

  test('getConfigOptions returns model option', () => {
    const options = backend.getConfigOptions();
    expect(options).toHaveLength(1);
    expect(options[0].name).toBe('model');
    expect(options[0].cliFlag).toBe('--model');
    expect(options[0].values).toContain('o4-mini');
  });

  describe('getStatus()', () => {
    test('reports unavailable when CLI not found', async () => {
      // Bun.which returns null when binary not found
      const status = await backend.getStatus();
      // CLI is likely not installed in test environment
      if (!status.available) {
        expect(status.error).toBe('codex CLI not found on PATH');
        expect(status.configured).toBe(false);
      }
    });

    test('reports configured when CODEX_API_KEY is set', async () => {
      process.env.CODEX_API_KEY = 'sk-test-key-123456789012';
      const status = await backend.getStatus();
      expect(status.authenticated).toBe(true);
      expect(status.authMode).toBe('api_key');
      expect(status.apiKeyMasked).toBe('...9012');
    });

    test('reports configured when OPENAI_API_KEY is set', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key-abcdef012345';
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
