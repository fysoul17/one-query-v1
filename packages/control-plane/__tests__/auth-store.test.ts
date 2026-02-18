import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ApiKeyScope } from '@autonomy/shared';
import { AuthStore } from '../src/auth-store.ts';

describe('AuthStore', () => {
  let db: Database;
  let store: AuthStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new AuthStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('creates a key and returns raw key', () => {
    const result = store.create({
      name: 'Test Key',
      scopes: [ApiKeyScope.READ, ApiKeyScope.WRITE],
    });

    expect(result.rawKey).toStartWith('ak_');
    expect(result.rawKey.length).toBeGreaterThan(10);
    expect(result.key.name).toBe('Test Key');
    expect(result.key.scopes).toEqual([ApiKeyScope.READ, ApiKeyScope.WRITE]);
    expect(result.key.enabled).toBe(true);
  });

  test('validates a raw key', () => {
    const { rawKey } = store.create({
      name: 'Test Key',
      scopes: [ApiKeyScope.ADMIN],
    });

    const validated = store.validateKey(rawKey);
    expect(validated).not.toBeNull();
    expect(validated?.name).toBe('Test Key');
  });

  test('rejects invalid key', () => {
    const validated = store.validateKey('ak_invalid_key_value');
    expect(validated).toBeNull();
  });

  test('rejects disabled key', () => {
    const { rawKey, key } = store.create({
      name: 'Disabled Key',
      scopes: [ApiKeyScope.READ],
    });

    store.update(key.id, { enabled: false });

    const validated = store.validateKey(rawKey);
    expect(validated).toBeNull();
  });

  test('rejects expired key', () => {
    const { rawKey } = store.create({
      name: 'Expired Key',
      scopes: [ApiKeyScope.READ],
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    const validated = store.validateKey(rawKey);
    expect(validated).toBeNull();
  });

  test('lists all keys', () => {
    store.create({ name: 'Key 1', scopes: [ApiKeyScope.READ] });
    store.create({ name: 'Key 2', scopes: [ApiKeyScope.WRITE] });

    const keys = store.list();
    expect(keys.length).toBe(2);
  });

  test('gets key by ID', () => {
    const { key } = store.create({ name: 'By ID', scopes: [ApiKeyScope.ADMIN] });

    const found = store.getById(key.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('By ID');
  });

  test('updates key fields', () => {
    const { key } = store.create({ name: 'Original', scopes: [ApiKeyScope.READ] });

    const updated = store.update(key.id, {
      name: 'Renamed',
      scopes: [ApiKeyScope.READ, ApiKeyScope.WRITE],
    });

    expect(updated.name).toBe('Renamed');
    expect(updated.scopes).toEqual([ApiKeyScope.READ, ApiKeyScope.WRITE]);
  });

  test('deletes a key', () => {
    const { key } = store.create({ name: 'To Delete', scopes: [ApiKeyScope.READ] });

    const deleted = store.delete(key.id);
    expect(deleted).toBe(true);

    const found = store.getById(key.id);
    expect(found).toBeNull();
  });

  test('delete returns false for non-existent key', () => {
    expect(store.delete('nonexistent')).toBe(false);
  });

  test('updates last_used_at on validation', async () => {
    const { rawKey, key } = store.create({
      name: 'Usage Key',
      scopes: [ApiKeyScope.READ],
    });

    expect(key.lastUsedAt).toBeUndefined();

    store.validateKey(rawKey);

    // last_used_at update is deferred via queueMicrotask
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = store.getById(key.id);
    expect(updated?.lastUsedAt).toBeDefined();
  });
});
