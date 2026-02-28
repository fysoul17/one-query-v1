import { describe, expect, test } from 'bun:test';
import { DefaultBackendRegistry } from '@autonomy/agent-manager';
import { AIBackend, BACKEND_CAPABILITIES, type BackendStatus } from '@autonomy/shared';
import { createBackendRoutes } from '../../src/routes/backends.ts';

/** Mock CLIBackend with configurable getStatus() response. */
class StatusMockBackend {
  readonly name: string;
  readonly capabilities;
  private statusOverride?: BackendStatus;

  constructor(name: string, statusOverride?: Partial<BackendStatus>) {
    this.name = name;
    this.capabilities = BACKEND_CAPABILITIES[name as AIBackend] ?? {
      customTools: false,
      streaming: false,
      sessionPersistence: false,
      fileAccess: false,
    };
    if (statusOverride) {
      this.statusOverride = {
        name: name as AIBackend,
        available: true,
        configured: true,
        authenticated: true,
        authMode: 'api_key',
        capabilities: this.capabilities,
        ...statusOverride,
      };
    }
  }

  async spawn() {
    return { send: async () => 'mock', stop: async () => {}, alive: true };
  }

  async getStatus(): Promise<BackendStatus> {
    if (this.statusOverride) return this.statusOverride;
    return {
      name: this.name as AIBackend,
      available: true,
      configured: true,
      authenticated: true,
      authMode: 'api_key',
      capabilities: this.capabilities,
    };
  }
}

/** Parse the API response envelope: { success, data }. */
async function parseResponse(res: Response) {
  const envelope = await res.json();
  expect(envelope.success).toBe(true);
  return envelope.data;
}

describe('GET /api/backends/status', () => {
  test('returns correct response shape', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.status();
    const data = await parseResponse(res);

    expect(data.defaultBackend).toBe('claude');
    expect(data.backends).toBeInstanceOf(Array);
    expect(data.backends).toHaveLength(1);
    expect(data.backends[0].name).toBe('claude');
  });

  test('returns all registered backends', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('claude') as any);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('codex') as any);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('gemini') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.status();
    const data = await parseResponse(res);

    expect(data.backends).toHaveLength(3);
    const names = data.backends.map((b: BackendStatus) => b.name);
    expect(names).toContain('claude');
    expect(names).toContain('codex');
    expect(names).toContain('gemini');
  });

  test('reflects correct default backend', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CODEX);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('codex') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.status();
    const data = await parseResponse(res);

    expect(data.defaultBackend).toBe('codex');
  });

  test('returns backend availability and configured status', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    registry.register(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      new StatusMockBackend('claude', { available: true, configured: true }) as any,
    );
    registry.register(
      new StatusMockBackend('codex', {
        available: false,
        configured: false,
        error: 'Not installed',
        // biome-ignore lint/suspicious/noExplicitAny: test mock
      }) as any,
    );

    const routes = createBackendRoutes(registry);
    const res = await routes.status();
    const data = await parseResponse(res);

    const claude = data.backends.find((b: BackendStatus) => b.name === 'claude');
    expect(claude.available).toBe(true);
    expect(claude.configured).toBe(true);

    const codex = data.backends.find((b: BackendStatus) => b.name === 'codex');
    expect(codex.available).toBe(false);
    expect(codex.configured).toBe(false);
    expect(codex.error).toBe('Not installed');
  });

  test('returns capabilities for each backend', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.status();
    const data = await parseResponse(res);

    const claude = data.backends[0];
    expect(claude.capabilities).toEqual(BACKEND_CAPABILITIES.claude);
    expect(claude.capabilities.streaming).toBe(true);
    expect(claude.capabilities.customTools).toBe(true);
  });

  test('returns masked API key when present', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('claude', { apiKeyMasked: 'sk-ant...7x4Q' }) as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.status();
    const data = await parseResponse(res);

    expect(data.backends[0].apiKeyMasked).toBe('sk-ant...7x4Q');
  });

  test('returns authMode for each backend', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('claude', { authMode: 'cli_login' }) as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.status();
    const data = await parseResponse(res);

    expect(data.backends[0].authMode).toBe('cli_login');
  });

  test('response is valid JSON with correct content-type', async () => {
    const registry = new DefaultBackendRegistry(AIBackend.CLAUDE);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registry.register(new StatusMockBackend('claude') as any);

    const routes = createBackendRoutes(registry);
    const res = await routes.status();

    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.status).toBe(200);
  });
});
