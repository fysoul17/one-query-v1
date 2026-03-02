import { describe, expect, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { ClaudeBackend } from '../src/backends/claude.ts';
import { DefaultBackendRegistry } from '../src/backends/registry.ts';
import { MockBackend } from './helpers/mock-backend.ts';

describe('ClaudeBackend.getStatus()', () => {
  test('returns BackendStatus with correct name and capabilities', async () => {
    const backend = new ClaudeBackend();
    const status = await backend.getStatus();

    expect(status.name).toBe(AIBackend.CLAUDE);
    expect(status.capabilities).toEqual(BACKEND_CAPABILITIES[AIBackend.CLAUDE]);
    expect(typeof status.available).toBe('boolean');
    expect(typeof status.configured).toBe('boolean');
    expect(['api_key', 'cli_login', 'none']).toContain(status.authMode);
  });

  test('detects API key auth mode when ANTHROPIC_API_KEY is set', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-1234567890abcdef';

    try {
      const backend = new ClaudeBackend();
      const status = await backend.getStatus();

      expect(status.authMode).toBe('api_key');
      expect(status.configured).toBe(true);
      expect(status.apiKeyMasked).toBe('...cdef');
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test('masks API key correctly — shows only last 4 chars', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-abcdefghijklmnop';

    try {
      const backend = new ClaudeBackend();
      const status = await backend.getStatus();

      expect(status.apiKeyMasked).toBe('...mnop');
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test('returns undefined apiKeyMasked when key is too short', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'short';

    try {
      const backend = new ClaudeBackend();
      const status = await backend.getStatus();

      expect(status.apiKeyMasked).toBeUndefined();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test('returns undefined apiKeyMasked when no key is set', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const backend = new ClaudeBackend();
      const status = await backend.getStatus();

      expect(status.apiKeyMasked).toBeUndefined();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });
});

describe('DefaultBackendRegistry.getStatusAll()', () => {
  test('returns status for all registered backends', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    registry.register(new ClaudeBackend());

    const statuses = await registry.getStatusAll();

    expect(statuses).toHaveLength(1);
    expect(statuses[0].name).toBe(AIBackend.CLAUDE);
  });

  test('returns fallback status for backends without getStatus()', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // MockBackend does not implement getStatus()
    const mock = new MockBackend('codex' as AIBackend, {
      customTools: false,
      streaming: true,
      sessionPersistence: true,
      fileAccess: true,
    });
    registry.register(mock);

    const statuses = await registry.getStatusAll();

    expect(statuses).toHaveLength(1);
    expect(statuses[0].name).toBe('codex');
    expect(statuses[0].available).toBe(false);
    expect(statuses[0].configured).toBe(false);
    expect(statuses[0].authMode).toBe('none');
    expect(statuses[0].error).toBe('Status check not implemented');
  });

  test('returns statuses for multiple backends', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    registry.register(new ClaudeBackend());
    registry.register(
      new MockBackend('codex' as AIBackend, {
        customTools: false,
        streaming: true,
        sessionPersistence: true,
        fileAccess: true,
      }),
    );

    const statuses = await registry.getStatusAll();

    expect(statuses).toHaveLength(2);
    const names = statuses.map((s) => s.name);
    expect(names).toContain(AIBackend.CLAUDE);
    expect(names).toContain('codex');
  });
});

describe('DefaultBackendRegistry.getDefaultName()', () => {
  test('returns the configured default backend name', () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    expect(registry.getDefaultName()).toBe(AIBackend.CLAUDE);
  });

  test('returns codex when configured as default', () => {
    const registry = new DefaultBackendRegistry(AIBackend.CODEX);
    expect(registry.getDefaultName()).toBe(AIBackend.CODEX);
  });
});
