import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULTS, type EnvironmentConfig } from '@autonomy/shared';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigManager } from '../../src/config-manager.ts';
import { createConfigRoutes } from '../../src/routes/config.ts';

const TEST_DATA_DIR = join(import.meta.dir, '.test-data-config-routes');

function makeConfig(overrides?: Partial<EnvironmentConfig>): EnvironmentConfig {
  return {
    DATA_DIR: TEST_DATA_DIR,
    PORT: DEFAULTS.PORT,
    RUNTIME_URL: DEFAULTS.RUNTIME_URL,
    AI_BACKEND: DEFAULTS.AI_BACKEND,
    IDLE_TIMEOUT_MS: DEFAULTS.IDLE_TIMEOUT_MS,
    MAX_AGENTS: DEFAULTS.MAX_AGENTS,
    VECTOR_PROVIDER: DEFAULTS.VECTOR_PROVIDER,
    LOG_LEVEL: DEFAULTS.LOG_LEVEL,
    MODE: DEFAULTS.MODE,
    ...overrides,
  };
}

describe('Config routes', () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
  });

  describe('GET /api/config', () => {
    test('returns config with redacted API key', async () => {
      const cm = new ConfigManager(makeConfig({ ANTHROPIC_API_KEY: 'sk-secret-key-123' }));
      cm.initialize();
      const routes = createConfigRoutes(cm);

      const res = await routes.get();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.ANTHROPIC_API_KEY).toBe('***');
      expect(body.data.PORT).toBe(DEFAULTS.PORT);
    });

    test('omits API key when not set', async () => {
      const cm = new ConfigManager(makeConfig());
      cm.initialize();
      const routes = createConfigRoutes(cm);

      const res = await routes.get();
      const body = await res.json();

      expect(body.data.ANTHROPIC_API_KEY).toBeUndefined();
    });
  });

  describe('PUT /api/config', () => {
    test('updates config fields', async () => {
      const cm = new ConfigManager(makeConfig());
      cm.initialize();
      const routes = createConfigRoutes(cm);

      const req = new Request('http://localhost/api/config', {
        method: 'PUT',
        body: JSON.stringify({ MAX_AGENTS: 25 }),
      });

      const res = await routes.update(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.MAX_AGENTS).toBe(25);
    });

    test('rejects API key updates with 400', async () => {
      const cm = new ConfigManager(makeConfig());
      cm.initialize();
      const routes = createConfigRoutes(cm);

      const req = new Request('http://localhost/api/config', {
        method: 'PUT',
        body: JSON.stringify({ ANTHROPIC_API_KEY: 'sk-new-key' }),
      });

      // The BadRequestError gets thrown and would be caught by the router
      await expect(routes.update(req)).rejects.toThrow('Cannot update sensitive fields');
    });

    test('preserves existing config on partial update', async () => {
      const cm = new ConfigManager(makeConfig({ MAX_AGENTS: 10 }));
      cm.initialize();
      const routes = createConfigRoutes(cm);

      const req = new Request('http://localhost/api/config', {
        method: 'PUT',
        body: JSON.stringify({ AI_BACKEND: 'claude' }),
      });

      const res = await routes.update(req);
      const body = await res.json();

      expect(body.data.MAX_AGENTS).toBe(10);
      expect(body.data.AI_BACKEND).toBe('claude');
    });
  });
});
