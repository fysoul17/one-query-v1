import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentDefinition } from '@autonomy/shared';
import { AgentStore } from '../src/agent-store.ts';

function makeDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Agent',
    role: 'tester',
    tools: ['bash', 'read'],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: 'user',
    persistent: false,
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}

describe('AgentStore', () => {
  let db: Database;
  let store: AgentStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new AgentStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('save()', () => {
    test('saves an agent definition', () => {
      const def = makeDef({ id: 'save-test' });
      store.save(def);

      const found = store.getById('save-test');
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Test Agent');
      expect(found?.role).toBe('tester');
      expect(found?.tools).toEqual(['bash', 'read']);
      expect(found?.canModifyFiles).toBe(false);
      expect(found?.owner).toBe('user');
    });

    test('saves optional fields', () => {
      const def = makeDef({
        id: 'opt-fields',
        sessionId: 'sess-123',
        backend: 'claude' as AgentDefinition['backend'],
        backendModel: 'sonnet',
      });
      store.save(def);

      const found = store.getById('opt-fields');
      expect(found?.sessionId).toBe('sess-123');
      expect(found?.backend).toBe('claude');
      expect(found?.backendModel).toBe('sonnet');
    });

    test('saves with undefined optional fields as null', () => {
      const def = makeDef({ id: 'no-opts' });
      store.save(def);

      const found = store.getById('no-opts');
      expect(found?.sessionId).toBeUndefined();
      expect(found?.backend).toBeUndefined();
      expect(found?.backendModel).toBeUndefined();
    });
  });

  describe('update()', () => {
    test('updates an existing agent', () => {
      const def = makeDef({ id: 'upd-test', name: 'Original' });
      store.save(def);

      const updated = { ...def, name: 'Updated', role: 'worker' };
      store.update('upd-test', updated);

      const found = store.getById('upd-test');
      expect(found?.name).toBe('Updated');
      expect(found?.role).toBe('worker');
    });

    test('sets user_modified flag on update', () => {
      const def = makeDef({ id: 'mod-flag', createdBy: 'seed' });
      store.save(def);

      // After save, upsertSeed should work
      expect(store.upsertSeed(makeDef({ id: 'mod-flag', createdBy: 'seed', name: 'v2' }))).toBe(
        true,
      );

      // After update(), user_modified = 1, so upsertSeed should skip
      store.update('mod-flag', { ...def, name: 'user-edit' });
      expect(store.upsertSeed(makeDef({ id: 'mod-flag', createdBy: 'seed', name: 'v3' }))).toBe(
        false,
      );
    });
  });

  describe('delete()', () => {
    test('deletes an existing agent', () => {
      const def = makeDef({ id: 'del-test' });
      store.save(def);
      expect(store.getById('del-test')).not.toBeNull();

      store.delete('del-test');
      expect(store.getById('del-test')).toBeNull();
    });

    test('delete non-existent agent is no-op', () => {
      store.delete('ghost');
      // Should not throw
    });
  });

  describe('list()', () => {
    test('returns empty array when no agents', () => {
      expect(store.list()).toEqual([]);
    });

    test('returns all agents ordered by created_at', () => {
      store.save(makeDef({ id: 'a1', createdAt: '2025-01-01T00:00:00Z' }));
      store.save(makeDef({ id: 'a2', createdAt: '2025-01-02T00:00:00Z' }));
      store.save(makeDef({ id: 'a3', createdAt: '2025-01-03T00:00:00Z' }));

      const agents = store.list();
      expect(agents).toHaveLength(3);
      expect(agents[0].id).toBe('a1');
      expect(agents[2].id).toBe('a3');
    });
  });

  describe('getById()', () => {
    test('returns null for non-existent agent', () => {
      expect(store.getById('nope')).toBeNull();
    });

    test('returns the correct agent', () => {
      store.save(makeDef({ id: 'get-one', name: 'Found' }));
      store.save(makeDef({ id: 'get-two', name: 'Other' }));

      const found = store.getById('get-one');
      expect(found?.name).toBe('Found');
    });
  });

  describe('upsertSeed()', () => {
    test('inserts a new seed agent', () => {
      const def = makeDef({ id: 'seed-new', createdBy: 'seed' });
      const result = store.upsertSeed(def);
      expect(result).toBe(true);
      expect(store.getById('seed-new')).not.toBeNull();
    });

    test('updates an unmodified seed agent', () => {
      const def = makeDef({ id: 'seed-upd', createdBy: 'seed', name: 'v1' });
      store.save(def);

      const updated = makeDef({ id: 'seed-upd', createdBy: 'seed', name: 'v2' });
      const result = store.upsertSeed(updated);
      expect(result).toBe(true);
      expect(store.getById('seed-upd')?.name).toBe('v2');
    });

    test('skips user-modified seed agent', () => {
      const def = makeDef({ id: 'seed-mod', createdBy: 'seed', name: 'v1' });
      store.save(def);

      // Simulate user modification
      store.update('seed-mod', { ...def, name: 'user-edit' });

      const seedUpdate = makeDef({ id: 'seed-mod', createdBy: 'seed', name: 'v3' });
      const result = store.upsertSeed(seedUpdate);
      expect(result).toBe(false);
      expect(store.getById('seed-mod')?.name).toBe('user-edit');
    });

    test('skips non-seed source agent', () => {
      const def = makeDef({ id: 'api-agent', createdBy: 'user', name: 'Original' });
      store.save(def);

      const seedUpdate = makeDef({ id: 'api-agent', createdBy: 'seed', name: 'Overwrite' });
      const result = store.upsertSeed(seedUpdate);
      expect(result).toBe(false);
      expect(store.getById('api-agent')?.name).toBe('Original');
    });
  });

  describe('data types preserved', () => {
    test('boolean fields round-trip correctly', () => {
      const def = makeDef({
        id: 'bool-test',
        canModifyFiles: true,
        canDelegateToAgents: true,
        persistent: true,
      });
      store.save(def);

      const found = store.getById('bool-test');
      expect(found?.canModifyFiles).toBe(true);
      expect(found?.canDelegateToAgents).toBe(true);
      expect(found?.persistent).toBe(true);
    });

    test('array fields round-trip correctly', () => {
      const def = makeDef({ id: 'arr-test', tools: ['bash', 'read', 'write'] });
      store.save(def);

      const found = store.getById('arr-test');
      expect(found?.tools).toEqual(['bash', 'read', 'write']);
    });
  });
});
