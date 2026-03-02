import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultBackendRegistry } from '@autonomy/agent-manager';
import { AIBackend, BACKEND_CAPABILITIES, type BackendStatus } from '@autonomy/shared';
import { createBackendRoutes } from '../../src/routes/backends.ts';
import { SecretStore } from '../../src/secret-store.ts';

/** Mock CLIBackend with configurable getStatus() response and optional logout(). */
class MockBackend {
  readonly name: string;
  readonly capabilities;
  private logoutCalled = false;
  private logoutError?: Error;

  constructor(
    name: string,
    private opts?: { logoutError?: Error },
  ) {
    this.name = name;
    this.capabilities = BACKEND_CAPABILITIES[name as AIBackend] ?? {
      customTools: false,
      streaming: false,
      sessionPersistence: false,
      fileAccess: false,
    };
  }

  async spawn() {
    return { send: async () => 'mock', stop: async () => {}, alive: true };
  }

  async getStatus(): Promise<BackendStatus> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const hasApiKey = !!apiKey;
    return {
      name: this.name as AIBackend,
      available: true,
      configured: true,
      authenticated: true,
      authMode: hasApiKey ? 'api_key' : 'cli_login',
      apiKeyMasked: hasApiKey ? `...${apiKey?.slice(-4)}` : undefined,
      capabilities: this.capabilities,
    };
  }

  async logout(): Promise<void> {
    if (this.opts?.logoutError) {
      throw this.opts.logoutError;
    }
    this.logoutCalled = true;
  }

  get wasLogoutCalled() {
    return this.logoutCalled;
  }
}

/** Mock backend without logout method. */
class MockBackendNoLogout {
  readonly name: string;
  readonly capabilities;

  constructor(name: string) {
    this.name = name;
    this.capabilities = BACKEND_CAPABILITIES[name as AIBackend] ?? {
      customTools: false,
      streaming: false,
      sessionPersistence: false,
      fileAccess: false,
    };
  }

  async spawn() {
    return { send: async () => 'mock', stop: async () => {}, alive: true };
  }

  async getStatus(): Promise<BackendStatus> {
    return {
      name: this.name as AIBackend,
      available: true,
      configured: true,
      authenticated: true,
      authMode: 'cli_login',
      capabilities: this.capabilities,
    };
  }
}

/** Parse the API response envelope: { success, data }. */
async function parseResponse(res: Response) {
  return (await res.json()) as { success: boolean; data?: unknown; error?: string };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/backends/api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/backends/api-key', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test('sets API key when provided', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makeRequest({ apiKey: 'sk-ant-test-key-1234567890' }));
    const envelope = await parseResponse(res);

    expect(res.status).toBe(200);
    expect(envelope.success).toBe(true);
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-test-key-1234567890');
  });

  test('clears API key when null', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-existing-key-value-0000';
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makeRequest({ apiKey: null }));
    expect(res.status).toBe(200);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('clears API key when empty string', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-existing-key-value-0000';
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makeRequest({ apiKey: '' }));
    expect(res.status).toBe(200);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('returns refreshed backend status after setting key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makeRequest({ apiKey: 'sk-ant-test-1234-abcdefgh' }));
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(true);
    const data = envelope.data as { defaultBackend: string; backends: BackendStatus[] };
    expect(data.defaultBackend).toBe('claude');
    expect(data.backends).toHaveLength(1);
    expect(data.backends[0].authMode).toBe('api_key');
  });

  test('trims whitespace from API key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    await routes.updateApiKey(makeRequest({ apiKey: '  sk-ant-test-key-padded00  ' }));
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-test-key-padded00');
  });

  test('rejects API key without sk-ant- prefix', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makeRequest({ apiKey: 'invalid-key-1234567890123456' }));
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('sk-ant-');
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('rejects API key shorter than 20 characters', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makeRequest({ apiKey: 'sk-ant-short' }));
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('20');
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('rejects missing apiKey field', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    // Body with no apiKey field — should treat as clearing
    const res = await routes.updateApiKey(makeRequest({}));
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/backends/:name/api-key — per-backend', () => {
  const originalCodexKey = process.env.CODEX_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    // Restore all keys
    for (const [key, orig] of [
      ['CODEX_API_KEY', originalCodexKey],
      ['GEMINI_API_KEY', originalGeminiKey],
      ['ANTHROPIC_API_KEY', originalAnthropicKey],
      ['OPENAI_API_KEY', undefined],
      ['GOOGLE_API_KEY', undefined],
    ] as const) {
      if (orig) {
        process.env[key] = orig;
      } else {
        delete process.env[key];
      }
    }
  });

  function makePerBackendRequest(body: unknown): Request {
    return new Request('http://localhost/api/backends/codex/api-key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('sets CODEX_API_KEY when backendName=codex', async () => {
    delete process.env.CODEX_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(
      makePerBackendRequest({ apiKey: 'sk-openai-test-key-12345' }),
      'codex',
    );
    expect(res.status).toBe(200);
    expect(process.env.CODEX_API_KEY).toBe('sk-openai-test-key-12345');
  });

  test('clears CODEX_API_KEY and OPENAI_API_KEY when backendName=codex', async () => {
    process.env.CODEX_API_KEY = 'sk-existing-key-00000000';
    process.env.OPENAI_API_KEY = 'sk-openai-alt-key-00000';
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makePerBackendRequest({ apiKey: null }), 'codex');
    expect(res.status).toBe(200);
    expect(process.env.CODEX_API_KEY).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  test('sets GEMINI_API_KEY when backendName=gemini', async () => {
    delete process.env.GEMINI_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(
      makePerBackendRequest({ apiKey: 'AIzaSyA-test-key-1234-abcd' }),
      'gemini',
    );
    expect(res.status).toBe(200);
    expect(process.env.GEMINI_API_KEY).toBe('AIzaSyA-test-key-1234-abcd');
  });

  test('clears GEMINI_API_KEY and GOOGLE_API_KEY when backendName=gemini', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyA-existing-key-0000';
    process.env.GOOGLE_API_KEY = 'AIzaSyA-alt-key-00000000';
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makePerBackendRequest({ apiKey: null }), 'gemini');
    expect(res.status).toBe(200);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.GOOGLE_API_KEY).toBeUndefined();
  });

  test('does not cross-contaminate: setting codex key does not affect ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-existing-key-value-0000';
    delete process.env.CODEX_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    await routes.updateApiKey(
      makePerBackendRequest({ apiKey: 'sk-openai-test-key-12345' }),
      'codex',
    );
    expect(process.env.CODEX_API_KEY).toBe('sk-openai-test-key-12345');
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-existing-key-value-0000');
  });

  test('accepts codex keys without sk-ant- prefix', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(
      makePerBackendRequest({ apiKey: 'sk-proj-test-key-1234567890' }),
      'codex',
    );
    expect(res.status).toBe(200);
    expect(process.env.CODEX_API_KEY).toBe('sk-proj-test-key-1234567890');
  });

  test('still validates sk-ant- prefix for claude', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(
      makePerBackendRequest({ apiKey: 'invalid-key-1234567890123456' }),
      'claude',
    );
    const envelope = await parseResponse(res);
    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('sk-ant-');
  });

  test('returns 400 for unknown backend', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(
      makePerBackendRequest({ apiKey: 'some-key-12345678901234' }),
      'unknown-backend',
    );
    const envelope = await parseResponse(res);
    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('unknown-backend');
  });
});

describe('POST /api/backends/:name/logout — generalized', () => {
  test('calls logout on claude backend', async () => {
    const backend = new MockBackend('claude');
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('claude');
    const envelope = await parseResponse(res);

    expect(res.status).toBe(200);
    expect(envelope.success).toBe(true);
    expect(backend.wasLogoutCalled).toBe(true);
  });

  test('calls logout on codex backend', async () => {
    const backend = new MockBackend('codex');
    const registry = new DefaultBackendRegistry(AIBackend.CODEX);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('codex');
    const envelope = await parseResponse(res);

    expect(res.status).toBe(200);
    expect(envelope.success).toBe(true);
    expect(backend.wasLogoutCalled).toBe(true);
  });

  test('calls logout on gemini backend', async () => {
    const backend = new MockBackend('gemini');
    const registry = new DefaultBackendRegistry(AIBackend.GEMINI);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('gemini');
    const envelope = await parseResponse(res);

    expect(res.status).toBe(200);
    expect(envelope.success).toBe(true);
    expect(backend.wasLogoutCalled).toBe(true);
  });

  test('returns 404 when requested backend not registered', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CODEX);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('claude');
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(false);
  });

  test('returns error when logout fails', async () => {
    const backend = new MockBackend('claude', {
      logoutError: new Error('CLI not found'),
    });
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('claude');
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('CLI not found');
  });

  test('returns refreshed status after successful logout', async () => {
    const backend = new MockBackend('claude');
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('claude');
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(true);
    const data = envelope.data as { defaultBackend: string; backends: BackendStatus[] };
    expect(data.defaultBackend).toBe('claude');
    expect(data.backends).toHaveLength(1);
  });

  test('returns 400 when backend has no logout method', async () => {
    const backend = new MockBackendNoLogout('claude');
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('claude');
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('not supported');
  });

  test('returns error for codex logout failure', async () => {
    const backend = new MockBackend('codex', {
      logoutError: new Error('codex CLI not found'),
    });
    const registry = new DefaultBackendRegistry(AIBackend.CODEX);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('codex');
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('codex CLI not found');
  });

  test('returns error for gemini logout failure', async () => {
    const backend = new MockBackend('gemini', {
      logoutError: new Error('gemini auth error'),
    });
    const registry = new DefaultBackendRegistry(AIBackend.GEMINI);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.logout('gemini');
    const envelope = await parseResponse(res);

    expect(envelope.success).toBe(false);
    expect(envelope.error).toContain('gemini auth error');
  });
});

describe('SecretStore integration with backend routes', () => {
  let testDir: string;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalCodexKey = process.env.CODEX_API_KEY;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `backend-secret-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    if (originalAnthropicKey) {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (originalCodexKey) {
      process.env.CODEX_API_KEY = originalCodexKey;
    } else {
      delete process.env.CODEX_API_KEY;
    }
    delete process.env.OPENAI_API_KEY;
  });

  test('updateApiKey persists key to SecretStore', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);
    const secretStore = new SecretStore(testDir);
    const routes = createBackendRoutes(registry, secretStore);

    await routes.updateApiKey(makeRequest({ apiKey: 'sk-ant-test-persist-key-00' }));

    const secrets = JSON.parse(readFileSync(join(testDir, 'secrets.json'), 'utf-8'));
    expect(secrets.ANTHROPIC_API_KEY).toBe('sk-ant-test-persist-key-00');
  });

  test('updateApiKey clears key from SecretStore when null', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);
    const secretStore = new SecretStore(testDir);

    // First set a key
    const routes = createBackendRoutes(registry, secretStore);
    await routes.updateApiKey(makeRequest({ apiKey: 'sk-ant-to-be-cleared-key-0' }));
    // Now clear it
    await routes.updateApiKey(makeRequest({ apiKey: null }));

    const secrets = JSON.parse(readFileSync(join(testDir, 'secrets.json'), 'utf-8'));
    expect(secrets.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('logout clears persisted keys from SecretStore', async () => {
    const backend = new MockBackend('claude');
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(backend as any);
    const secretStore = new SecretStore(testDir);

    // Pre-set a key
    secretStore.set('ANTHROPIC_API_KEY', 'sk-ant-logout-test-key-00');

    const routes = createBackendRoutes(registry, secretStore);
    await routes.logout('claude');

    const secrets = JSON.parse(readFileSync(join(testDir, 'secrets.json'), 'utf-8'));
    expect(secrets.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test('routes work without SecretStore (backward compatible)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new MockBackend('claude') as any);

    // No secretStore passed
    const routes = createBackendRoutes(registry);
    const res = await routes.updateApiKey(makeRequest({ apiKey: 'sk-ant-no-store-key-00000' }));
    expect(res.status).toBe(200);
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-no-store-key-00000');
  });
});
