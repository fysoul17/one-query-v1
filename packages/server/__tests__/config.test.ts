import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULTS } from '@autonomy/shared';
import { parseEnvConfig } from '../src/config.ts';

describe('parseEnvConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.PORT;
    delete process.env.DATA_DIR;
    delete process.env.RUNTIME_URL;
    delete process.env.AI_BACKEND;
    delete process.env.IDLE_TIMEOUT_MS;
    delete process.env.MAX_AGENTS;
    delete process.env.VECTOR_PROVIDER;
    delete process.env.QDRANT_URL;
    delete process.env.LOG_LEVEL;
    delete process.env.MODE;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test('returns defaults when no env vars set', () => {
    const config = parseEnvConfig();
    expect(config.PORT).toBe(DEFAULTS.PORT);
    expect(config.DATA_DIR).toBe(DEFAULTS.DATA_DIR);
    expect(config.AI_BACKEND).toBe(DEFAULTS.AI_BACKEND);
    expect(config.IDLE_TIMEOUT_MS).toBe(DEFAULTS.IDLE_TIMEOUT_MS);
    expect(config.MAX_AGENTS).toBe(DEFAULTS.MAX_AGENTS);
    expect(config.VECTOR_PROVIDER).toBe(DEFAULTS.VECTOR_PROVIDER);
    expect(config.LOG_LEVEL).toBe(DEFAULTS.LOG_LEVEL);
    expect(config.MODE).toBe(DEFAULTS.MODE);
  });

  test('reads PORT from env', () => {
    process.env.PORT = '8080';
    const config = parseEnvConfig();
    expect(config.PORT).toBe(8080);
  });

  test('throws on invalid PORT', () => {
    process.env.PORT = 'abc';
    expect(() => parseEnvConfig()).toThrow('Invalid PORT');
  });

  test('throws on negative PORT', () => {
    process.env.PORT = '-1';
    expect(() => parseEnvConfig()).toThrow('Invalid PORT');
  });

  test('throws on PORT > 65535', () => {
    process.env.PORT = '99999';
    expect(() => parseEnvConfig()).toThrow('Invalid PORT');
  });

  test('reads IDLE_TIMEOUT_MS from env', () => {
    process.env.IDLE_TIMEOUT_MS = '60000';
    const config = parseEnvConfig();
    expect(config.IDLE_TIMEOUT_MS).toBe(60000);
  });

  test('throws on invalid IDLE_TIMEOUT_MS', () => {
    process.env.IDLE_TIMEOUT_MS = 'not-a-number';
    expect(() => parseEnvConfig()).toThrow('Invalid IDLE_TIMEOUT_MS');
  });

  test('reads MAX_AGENTS from env', () => {
    process.env.MAX_AGENTS = '20';
    const config = parseEnvConfig();
    expect(config.MAX_AGENTS).toBe(20);
  });

  test('throws on MAX_AGENTS < 1', () => {
    process.env.MAX_AGENTS = '0';
    expect(() => parseEnvConfig()).toThrow('Invalid MAX_AGENTS');
  });

  test('reads DATA_DIR from env', () => {
    process.env.DATA_DIR = '/custom/data';
    const config = parseEnvConfig();
    expect(config.DATA_DIR).toBe('/custom/data');
  });

  test('reads ANTHROPIC_API_KEY from env', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const config = parseEnvConfig();
    expect(config.ANTHROPIC_API_KEY).toBe('sk-test-key');
  });

  test('ANTHROPIC_API_KEY is undefined when not set', () => {
    const config = parseEnvConfig();
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
