import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULTS, EmbeddingProviderName } from '@autonomy/shared';
import { parseMemoryServerConfig } from '../src/config.ts';

// Save original env and restore after each test
let savedEnv: Record<string, string | undefined>;
const CONFIG_KEYS = [
  'PORT',
  'DATA_DIR',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_API_KEY',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'NEO4J_URL',
  'NEO4J_USERNAME',
  'NEO4J_PASSWORD',
];

beforeEach(() => {
  savedEnv = {};
  for (const key of CONFIG_KEYS) {
    savedEnv[key] = Bun.env[key];
    delete Bun.env[key];
  }
});

afterEach(() => {
  for (const key of CONFIG_KEYS) {
    if (savedEnv[key] !== undefined) {
      Bun.env[key] = savedEnv[key];
    } else {
      delete Bun.env[key];
    }
  }
});

describe('parseMemoryServerConfig', () => {
  test('returns defaults when no env vars set', () => {
    const config = parseMemoryServerConfig();
    expect(config.PORT).toBe(DEFAULTS.MEMORY_SERVER_PORT);
    expect(config.DATA_DIR).toBe(DEFAULTS.DATA_DIR);
    expect(config.EMBEDDING_PROVIDER).toBe(DEFAULTS.EMBEDDING_PROVIDER);
    expect(config.EMBEDDING_API_KEY).toBeUndefined();
    expect(config.EMBEDDING_MODEL).toBeUndefined();
    expect(config.EMBEDDING_DIMENSIONS).toBeUndefined();
    expect(config.NEO4J_URL).toBeUndefined();
    expect(config.NEO4J_USERNAME).toBe('neo4j');
    expect(config.NEO4J_PASSWORD).toBeUndefined();
  });

  test('reads PORT from env', () => {
    Bun.env.PORT = '4000';
    const config = parseMemoryServerConfig();
    expect(config.PORT).toBe(4000);
  });

  test('throws on invalid PORT', () => {
    Bun.env.PORT = 'abc';
    expect(() => parseMemoryServerConfig()).toThrow('Invalid PORT');
  });

  test('throws on out-of-range PORT', () => {
    Bun.env.PORT = '99999';
    expect(() => parseMemoryServerConfig()).toThrow('Invalid PORT');
  });

  test('reads EMBEDDING_PROVIDER from env', () => {
    Bun.env.EMBEDDING_PROVIDER = EmbeddingProviderName.ANTHROPIC;
    const config = parseMemoryServerConfig();
    expect(config.EMBEDDING_PROVIDER).toBe(EmbeddingProviderName.ANTHROPIC);
  });

  test('reads EMBEDDING_DIMENSIONS from env', () => {
    Bun.env.EMBEDDING_DIMENSIONS = '768';
    const config = parseMemoryServerConfig();
    expect(config.EMBEDDING_DIMENSIONS).toBe(768);
  });

  test('throws on invalid EMBEDDING_DIMENSIONS', () => {
    Bun.env.EMBEDDING_DIMENSIONS = '0';
    expect(() => parseMemoryServerConfig()).toThrow('Invalid EMBEDDING_DIMENSIONS');
  });

  test('throws on negative EMBEDDING_DIMENSIONS', () => {
    Bun.env.EMBEDDING_DIMENSIONS = '-5';
    expect(() => parseMemoryServerConfig()).toThrow('Invalid EMBEDDING_DIMENSIONS');
  });

  test('reads NEO4J connection details from env', () => {
    Bun.env.NEO4J_URL = 'bolt://localhost:7687';
    Bun.env.NEO4J_USERNAME = 'admin';
    Bun.env.NEO4J_PASSWORD = 'secret';
    const config = parseMemoryServerConfig();
    expect(config.NEO4J_URL).toBe('bolt://localhost:7687');
    expect(config.NEO4J_USERNAME).toBe('admin');
    expect(config.NEO4J_PASSWORD).toBe('secret');
  });

  test('reads EMBEDDING_API_KEY and MODEL from env', () => {
    Bun.env.EMBEDDING_API_KEY = 'sk-test-123';
    Bun.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    const config = parseMemoryServerConfig();
    expect(config.EMBEDDING_API_KEY).toBe('sk-test-123');
    expect(config.EMBEDDING_MODEL).toBe('text-embedding-3-small');
  });

  test('reads DATA_DIR from env', () => {
    Bun.env.DATA_DIR = '/custom/data';
    const config = parseMemoryServerConfig();
    expect(config.DATA_DIR).toBe('/custom/data');
  });
});
