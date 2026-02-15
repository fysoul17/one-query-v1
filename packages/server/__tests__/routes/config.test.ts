import { describe, expect, test } from 'bun:test';
import { DEFAULTS } from '@autonomy/shared';
import { createConfigRoutes } from '../../src/routes/config.ts';
import type { EnvironmentConfig } from '@autonomy/shared';

function makeConfig(overrides?: Partial<EnvironmentConfig>): EnvironmentConfig {
  return {
    DATA_DIR: DEFAULTS.DATA_DIR,
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
  describe('GET /api/config', () => {
    test('returns config with redacted API key', async () => {
      const config = makeConfig({ ANTHROPIC_API_KEY: 'sk-secret-key-123' });
      const routes = createConfigRoutes(config);

      const res = await routes.get();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.ANTHROPIC_API_KEY).toBe('***');
      expect(body.data.PORT).toBe(DEFAULTS.PORT);
    });

    test('omits API key when not set', async () => {
      const config = makeConfig();
      const routes = createConfigRoutes(config);

      const res = await routes.get();
      const body = await res.json();

      expect(body.data.ANTHROPIC_API_KEY).toBeUndefined();
    });
  });

  describe('PUT /api/config', () => {
    test('returns 501 not implemented', async () => {
      const routes = createConfigRoutes(makeConfig());
      const res = await routes.update();
      expect(res.status).toBe(501);
    });
  });
});
