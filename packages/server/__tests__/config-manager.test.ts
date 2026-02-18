import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AIBackend, DEFAULTS, type EnvironmentConfig } from '@autonomy/shared';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigManager, ConfigUpdateError } from '../src/config-manager.ts';

const TEST_DATA_DIR = join(import.meta.dir, '.test-data-config');

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

describe('ConfigManager', () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  test('get() returns base config', () => {
    const cm = new ConfigManager(makeConfig());
    cm.initialize();
    const config = cm.get();
    expect(config.PORT).toBe(DEFAULTS.PORT);
    expect(config.AI_BACKEND).toBe(DEFAULTS.AI_BACKEND);
  });

  test('initialize() loads persisted overrides', () => {
    const overridesPath = join(TEST_DATA_DIR, 'config.json');
    writeFileSync(overridesPath, JSON.stringify({ AI_BACKEND: AIBackend.CODEX }));

    const cm = new ConfigManager(makeConfig());
    cm.initialize();
    expect(cm.get().AI_BACKEND).toBe(AIBackend.CODEX);
  });

  test('initialize() handles missing file gracefully', () => {
    const cm = new ConfigManager(makeConfig());
    cm.initialize();
    expect(cm.get().AI_BACKEND).toBe(DEFAULTS.AI_BACKEND);
  });

  test('initialize() handles corrupt file gracefully', () => {
    const overridesPath = join(TEST_DATA_DIR, 'config.json');
    writeFileSync(overridesPath, 'not json{{{');

    const cm = new ConfigManager(makeConfig());
    cm.initialize();
    expect(cm.get().AI_BACKEND).toBe(DEFAULTS.AI_BACKEND);
  });

  test('update() merges and persists config', () => {
    const cm = new ConfigManager(makeConfig());
    cm.initialize();

    const result = cm.update({ MAX_AGENTS: 20 });
    expect(result.MAX_AGENTS).toBe(20);

    // Verify persisted
    const overridesPath = join(TEST_DATA_DIR, 'config.json');
    expect(existsSync(overridesPath)).toBe(true);
    const persisted = JSON.parse(require('node:fs').readFileSync(overridesPath, 'utf-8'));
    expect(persisted.MAX_AGENTS).toBe(20);
  });

  test('update() rejects API key changes', () => {
    const cm = new ConfigManager(makeConfig());
    cm.initialize();

    expect(() => cm.update({ ANTHROPIC_API_KEY: 'new-key' })).toThrow(ConfigUpdateError);
  });

  test('update() rejects QDRANT_URL changes', () => {
    const cm = new ConfigManager(makeConfig());
    cm.initialize();

    expect(() => cm.update({ QDRANT_URL: 'http://bad' })).toThrow(ConfigUpdateError);
  });

  test('update() ignores unknown fields', () => {
    const cm = new ConfigManager(makeConfig());
    cm.initialize();

    const result = cm.update({ UNKNOWN_FIELD: 'value', MAX_AGENTS: 5 });
    expect(result.MAX_AGENTS).toBe(5);
    expect((result as Record<string, unknown>).UNKNOWN_FIELD).toBeUndefined();
  });

  test('second ConfigManager instance loads persisted changes', () => {
    const cm1 = new ConfigManager(makeConfig());
    cm1.initialize();
    cm1.update({ MAX_AGENTS: 42 });

    const cm2 = new ConfigManager(makeConfig());
    cm2.initialize();
    expect(cm2.get().MAX_AGENTS).toBe(42);
  });
});
