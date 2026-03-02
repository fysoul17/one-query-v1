import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { SessionStore } from '../src/session-store.ts';

describe('SessionStore backend session ID', () => {
  let db: Database;
  let store: SessionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    store = new SessionStore(db);
  });

  test('getBackendSessionId() returns undefined for unknown session ID', () => {
    const result = store.getBackendSessionId('nonexistent-session');
    expect(result).toBeUndefined();
  });

  test('getBackendSessionId() returns undefined for session with no backend ID set', () => {
    const session = store.create({ title: 'Test Session' });
    const result = store.getBackendSessionId(session.id);
    expect(result).toBeUndefined();
  });

  test('setBackendSessionId() then getBackendSessionId() round-trip works', () => {
    const session = store.create({ title: 'Test Session' });
    store.setBackendSessionId(session.id, 'native-sess-abc-123');
    const result = store.getBackendSessionId(session.id);
    expect(result).toBe('native-sess-abc-123');
  });

  test('setBackendSessionId() on non-existent session does not crash', () => {
    // UPDATE on non-existent row is a silent no-op in SQL
    expect(() => {
      store.setBackendSessionId('does-not-exist', 'some-backend-id');
    }).not.toThrow();

    // Verify it didn't create a phantom row
    const result = store.getBackendSessionId('does-not-exist');
    expect(result).toBeUndefined();
  });

  test('addColumnIfMissing() idempotency — constructing SessionStore twice on same DB works', () => {
    // First store is already created in beforeEach; create a second on the same DB.
    // The migration should detect backend_session_id already exists and skip ALTER TABLE.
    const store2 = new SessionStore(db);
    expect(store2).toBeDefined();

    // Both stores should still function correctly
    const session = store.create({ title: 'Idempotency Test' });
    store.setBackendSessionId(session.id, 'idempotent-sess');
    expect(store2.getBackendSessionId(session.id)).toBe('idempotent-sess');
  });

  test('backend_session_id column actually exists after migration', () => {
    const cols = db.query('PRAGMA table_info(sessions)').all() as { name: string }[];
    const columnNames = cols.map((c) => c.name);
    expect(columnNames).toContain('backend_session_id');
  });

  test('setBackendSessionId() overwrites previous value', () => {
    const session = store.create({ title: 'Overwrite Test' });
    store.setBackendSessionId(session.id, 'first-id');
    expect(store.getBackendSessionId(session.id)).toBe('first-id');

    store.setBackendSessionId(session.id, 'second-id');
    expect(store.getBackendSessionId(session.id)).toBe('second-id');
  });
});
