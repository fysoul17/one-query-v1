import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';
import type { AgentDefinition } from '@autonomy/shared';
import { AgentStore } from '../src/agent-store';

function makeDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: overrides.id ?? `agent-${crypto.randomUUID().slice(0, 8)}`,
    name: overrides.name ?? 'Test Agent',
    role: overrides.role ?? 'assistant',
    tools: overrides.tools ?? ['search'],
    canModifyFiles: overrides.canModifyFiles ?? false,
    canDelegateToAgents: overrides.canDelegateToAgents ?? false,
    maxConcurrent: overrides.maxConcurrent ?? 1,
    owner: overrides.owner ?? 'user',
    persistent: overrides.persistent ?? false,
    createdBy: overrides.createdBy ?? 'api',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    systemPrompt: overrides.systemPrompt ?? 'You are a test agent.',
    sessionId: overrides.sessionId,
    backend: overrides.backend,
    backendModel: overrides.backendModel,
  };
}

describe('AgentStore', () => {
  let db: Database;
  let store: AgentStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new AgentStore(db);
  });

  describe('save + getById', () => {
    it('saves and retrieves an agent', () => {
      const def = makeDefinition({ id: 'agent-1', name: 'Alpha' });
      store.save(def);

      const result = store.getById('agent-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('agent-1');
      expect(result?.name).toBe('Alpha');
      expect(result?.role).toBe('assistant');
      expect(result?.tools).toEqual(['search']);
      expect(result?.canModifyFiles).toBe(false);
      expect(result?.canDelegateToAgents).toBe(false);
      expect(result?.maxConcurrent).toBe(1);
      expect(result?.persistent).toBe(false);
      expect(result?.systemPrompt).toBe('You are a test agent.');
    });

    it('returns null for non-existent agent', () => {
      expect(store.getById('does-not-exist')).toBeNull();
    });

    it('preserves optional fields (sessionId, backend, backendModel)', () => {
      const def = makeDefinition({
        id: 'agent-opts',
        sessionId: 'sess-42',
        backend: 'claude' as AgentDefinition['backend'],
        backendModel: 'claude-3-opus',
      });
      store.save(def);

      const result = store.getById('agent-opts');
      expect(result?.sessionId).toBe('sess-42');
      expect(result?.backend).toBe('claude');
      expect(result?.backendModel).toBe('claude-3-opus');
    });

    it('handles undefined optional fields as undefined', () => {
      const def = makeDefinition({ id: 'agent-no-opts' });
      store.save(def);

      const result = store.getById('agent-no-opts');
      expect(result?.sessionId).toBeUndefined();
      expect(result?.backend).toBeUndefined();
      expect(result?.backendModel).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns empty array when no agents', () => {
      expect(store.list()).toEqual([]);
    });

    it('returns all agents ordered by created_at ASC', () => {
      const a = makeDefinition({ id: 'a', name: 'First', createdAt: '2026-01-01T00:00:00Z' });
      const b = makeDefinition({ id: 'b', name: 'Second', createdAt: '2026-01-02T00:00:00Z' });
      const c = makeDefinition({ id: 'c', name: 'Third', createdAt: '2026-01-03T00:00:00Z' });

      store.save(c);
      store.save(a);
      store.save(b);

      const result = store.list();
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('First');
      expect(result[1].name).toBe('Second');
      expect(result[2].name).toBe('Third');
    });
  });

  describe('update', () => {
    it('updates agent fields', () => {
      const def = makeDefinition({ id: 'agent-upd', name: 'Before' });
      store.save(def);

      const updated = makeDefinition({
        id: 'agent-upd',
        name: 'After',
        role: 'specialist',
        tools: ['search', 'write'],
        canModifyFiles: true,
        systemPrompt: 'Updated prompt.',
        backend: 'gemini' as AgentDefinition['backend'],
      });
      store.update('agent-upd', updated);

      const result = store.getById('agent-upd');
      expect(result?.name).toBe('After');
      expect(result?.role).toBe('specialist');
      expect(result?.tools).toEqual(['search', 'write']);
      expect(result?.canModifyFiles).toBe(true);
      expect(result?.systemPrompt).toBe('Updated prompt.');
      expect(result?.backend).toBe('gemini');
    });

    it('marks agent as user_modified after update', () => {
      const def = makeDefinition({ id: 'agent-mod', createdBy: 'seed' });
      store.save(def);

      // Seed agents start with user_modified=0
      const row = db.query('SELECT user_modified FROM agents WHERE id = ?').get('agent-mod') as {
        user_modified: number;
      };
      expect(row.user_modified).toBe(0);

      store.update('agent-mod', def);

      const updated = db
        .query('SELECT user_modified FROM agents WHERE id = ?')
        .get('agent-mod') as { user_modified: number };
      expect(updated.user_modified).toBe(1);
    });
  });

  describe('delete', () => {
    it('removes an agent', () => {
      const def = makeDefinition({ id: 'agent-del' });
      store.save(def);
      expect(store.getById('agent-del')).not.toBeNull();

      store.delete('agent-del');
      expect(store.getById('agent-del')).toBeNull();
    });

    it('is a no-op for non-existent agent', () => {
      // Should not throw
      store.delete('does-not-exist');
    });
  });

  describe('upsertSeed', () => {
    it('inserts new seed agent when none exists', () => {
      const def = makeDefinition({ id: 'seed-1', createdBy: 'seed', name: 'Seeded' });
      const inserted = store.upsertSeed(def);

      expect(inserted).toBe(true);
      expect(store.getById('seed-1')?.name).toBe('Seeded');
    });

    it('updates existing seed agent that has not been user-modified', () => {
      const def = makeDefinition({ id: 'seed-2', createdBy: 'seed', name: 'Original' });
      store.save(def);

      const updated = makeDefinition({ id: 'seed-2', createdBy: 'seed', name: 'Updated Seed' });
      const result = store.upsertSeed(updated);

      expect(result).toBe(true);
      expect(store.getById('seed-2')?.name).toBe('Updated Seed');
    });

    it('skips update for user-modified seed agent', () => {
      const def = makeDefinition({ id: 'seed-3', createdBy: 'seed', name: 'Original' });
      store.save(def);

      // Simulate user modification
      store.update('seed-3', makeDefinition({ id: 'seed-3', name: 'User Modified' }));

      const seedUpdate = makeDefinition({
        id: 'seed-3',
        createdBy: 'seed',
        name: 'New Seed Value',
      });
      const result = store.upsertSeed(seedUpdate);

      expect(result).toBe(false);
      expect(store.getById('seed-3')?.name).toBe('User Modified');
    });

    it('skips update for non-seed source agent', () => {
      const def = makeDefinition({ id: 'api-agent', createdBy: 'api', name: 'API Created' });
      store.save(def);

      const seedUpdate = makeDefinition({
        id: 'api-agent',
        createdBy: 'seed',
        name: 'Seed Override',
      });
      const result = store.upsertSeed(seedUpdate);

      expect(result).toBe(false);
      expect(store.getById('api-agent')?.name).toBe('API Created');
    });
  });

  describe('source derivation', () => {
    it('derives source "seed" for createdBy=seed', () => {
      const def = makeDefinition({ id: 'src-seed', createdBy: 'seed' });
      store.save(def);
      const row = db.query('SELECT source FROM agents WHERE id = ?').get('src-seed') as {
        source: string;
      };
      expect(row.source).toBe('seed');
    });

    it('derives source "conductor" for createdBy=conductor', () => {
      const def = makeDefinition({ id: 'src-cond', createdBy: 'conductor' });
      store.save(def);
      const row = db.query('SELECT source FROM agents WHERE id = ?').get('src-cond') as {
        source: string;
      };
      expect(row.source).toBe('conductor');
    });

    it('derives source "api" for other createdBy values', () => {
      const def = makeDefinition({ id: 'src-api', createdBy: 'user' });
      store.save(def);
      const row = db.query('SELECT source FROM agents WHERE id = ?').get('src-api') as {
        source: string;
      };
      expect(row.source).toBe('api');
    });
  });

  describe('migrate (idempotent)', () => {
    it('can be called multiple times without error', () => {
      // Constructor already called migrate once, calling again via new store on same DB
      const store2 = new AgentStore(db);
      const def = makeDefinition({ id: 'migrate-test' });
      store2.save(def);
      expect(store2.getById('migrate-test')).not.toBeNull();
    });
  });
});
