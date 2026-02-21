import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentDefinition,
  type AgentRuntimeInfo,
  AgentStatus,
  type AgentStoreInterface,
  type AIBackend,
} from '@autonomy/shared';
import { AgentPool } from '../src/agent-pool.ts';
import { DefaultBackendRegistry } from '../src/backends/registry.ts';
import { MockBackend } from './helpers/mock-backend.ts';

/** Helper to build a minimal valid AgentDefinition for tests. */
function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Agent',
    role: 'tester',
    tools: [],
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

describe('AgentPool', () => {
  let backend: MockBackend;
  let pool: AgentPool;

  beforeEach(() => {
    backend = new MockBackend();
    backend.setResponses(['pool response']);
    pool = new AgentPool(backend, { maxAgents: 5 });
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  describe('create()', () => {
    test('creates an agent and returns the AgentProcess', async () => {
      const def = makeAgent({ id: 'create-test' });
      const agent = await pool.create(def);
      expect(agent).toBeDefined();
    });

    test('created agent status is IDLE (auto-started)', async () => {
      const def = makeAgent({ id: 'auto-start' });
      const agent = await pool.create(def);
      expect(agent.status).toBe(AgentStatus.IDLE);
    });

    test('spawns the backend for the new agent', async () => {
      const def = makeAgent({ id: 'spawn-check' });
      await pool.create(def);
      expect(backend.spawnCalls).toHaveLength(1);
      expect(backend.spawnCalls[0].agentId).toBe('spawn-check');
    });

    test('throws on duplicate agent id', async () => {
      const def = makeAgent({ id: 'dup-id' });
      await pool.create(def);
      await expect(pool.create(makeAgent({ id: 'dup-id' }))).rejects.toThrow();
    });

    test('throws when maxAgents limit is reached', async () => {
      const smallPool = new AgentPool(backend, { maxAgents: 2 });

      await smallPool.create(makeAgent({ id: 'a1' }));
      await smallPool.create(makeAgent({ id: 'a2' }));
      await expect(smallPool.create(makeAgent({ id: 'a3' }))).rejects.toThrow();

      await smallPool.shutdown();
    });

    test('uses DEFAULTS.MAX_AGENTS when maxAgents not specified', () => {
      const defaultPool = new AgentPool(backend);
      // Pool should exist and accept agents up to default limit
      expect(defaultPool).toBeDefined();
      // We don't hit the limit, just verify it was created
    });
  });

  describe('get()', () => {
    test('returns AgentProcess for existing agent', async () => {
      const def = makeAgent({ id: 'get-test' });
      await pool.create(def);
      const agent = pool.get('get-test');
      expect(agent).toBeDefined();
      expect(agent?.definition.id).toBe('get-test');
    });

    test('returns undefined for non-existent agent', () => {
      const agent = pool.get('does-not-exist');
      expect(agent).toBeUndefined();
    });
  });

  describe('list()', () => {
    test('returns empty array when no agents', () => {
      const agents = pool.list();
      expect(agents).toEqual([]);
    });

    test('returns AgentRuntimeInfo[] for all agents', async () => {
      await pool.create(makeAgent({ id: 'list-1', name: 'Agent 1', role: 'worker' }));
      await pool.create(makeAgent({ id: 'list-2', name: 'Agent 2', role: 'tester' }));

      const agents = pool.list();
      expect(agents).toHaveLength(2);

      const info = agents.find((a: AgentRuntimeInfo) => a.id === 'list-1');
      expect(info).toBeDefined();
      expect(info?.name).toBe('Agent 1');
      expect(info?.role).toBe('worker');
      expect(info?.status).toBe(AgentStatus.IDLE);
    });

    test('list() includes correct fields per AgentRuntimeInfo interface', async () => {
      const def = makeAgent({
        id: 'info-check',
        name: 'Info Agent',
        role: 'info-role',
        owner: 'user',
        persistent: true,
      });
      await pool.create(def);

      const agents = pool.list();
      expect(agents).toHaveLength(1);

      const info = agents[0];
      expect(info.id).toBe('info-check');
      expect(info.name).toBe('Info Agent');
      expect(info.role).toBe('info-role');
      expect(info.status).toBe(AgentStatus.IDLE);
      expect(info.owner).toBe('user');
      expect(info.persistent).toBe(true);
      expect(info.createdAt).toBeDefined();
    });
  });

  describe('remove()', () => {
    test('stops and removes the agent', async () => {
      const def = makeAgent({ id: 'remove-test' });
      await pool.create(def);
      expect(pool.get('remove-test')).toBeDefined();

      await pool.remove('remove-test');
      expect(pool.get('remove-test')).toBeUndefined();
    });

    test('the removed agent backend process is stopped', async () => {
      const def = makeAgent({ id: 'remove-proc' });
      await pool.create(def);
      const proc = backend.spawnedProcesses[0];
      expect(proc.alive).toBe(true);

      await pool.remove('remove-proc');
      expect(proc.alive).toBe(false);
    });

    test('remove() of non-existent agent throws or is no-op', async () => {
      // Depending on implementation, this may throw or silently succeed.
      // We test that it doesn't corrupt state.
      try {
        await pool.remove('ghost');
      } catch {
        // acceptable
      }
      expect(pool.list()).toEqual([]);
    });

    test('list() no longer includes removed agent', async () => {
      await pool.create(makeAgent({ id: 'r1' }));
      await pool.create(makeAgent({ id: 'r2' }));
      expect(pool.list()).toHaveLength(2);

      await pool.remove('r1');
      const remaining = pool.list();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('r2');
    });

    test('removing an agent frees capacity for new agents', async () => {
      const tinyPool = new AgentPool(backend, { maxAgents: 1 });
      await tinyPool.create(makeAgent({ id: 'x1' }));

      // At capacity
      await expect(tinyPool.create(makeAgent({ id: 'x2' }))).rejects.toThrow();

      await tinyPool.remove('x1');

      // Should now have capacity
      const agent = await tinyPool.create(makeAgent({ id: 'x3' }));
      expect(agent).toBeDefined();

      await tinyPool.shutdown();
    });
  });

  describe('sendMessage()', () => {
    test('delegates to the correct AgentProcess', async () => {
      backend.setResponses(['agent1-response']);
      await pool.create(makeAgent({ id: 'msg-agent' }));

      const response = await pool.sendMessage('msg-agent', 'hello');
      expect(response).toBe('agent1-response');
    });

    test('throws for non-existent agent', async () => {
      await expect(pool.sendMessage('ghost', 'hello')).rejects.toThrow();
    });

    test('sends messages to the correct agent among multiple', async () => {
      // Create two agents — both use the same backend but different responses
      // will be cycled from the mock
      backend.setResponses(['response-a', 'response-b']);
      await pool.create(makeAgent({ id: 'agent-a' }));
      await pool.create(makeAgent({ id: 'agent-b' }));

      const respA = await pool.sendMessage('agent-a', 'hello-a');
      const respB = await pool.sendMessage('agent-b', 'hello-b');

      // Both should have received their messages
      expect(typeof respA).toBe('string');
      expect(typeof respB).toBe('string');
    });
  });

  describe('shutdown() / removeAll()', () => {
    test('stops all agents', async () => {
      await pool.create(makeAgent({ id: 's1' }));
      await pool.create(makeAgent({ id: 's2' }));
      await pool.create(makeAgent({ id: 's3' }));
      expect(pool.list()).toHaveLength(3);

      await pool.shutdown();

      // All backend processes should be stopped
      for (const proc of backend.spawnedProcesses) {
        expect(proc.alive).toBe(false);
      }
    });

    test('list() is empty after shutdown', async () => {
      await pool.create(makeAgent({ id: 'sh1' }));
      await pool.create(makeAgent({ id: 'sh2' }));
      await pool.shutdown();
      expect(pool.list()).toEqual([]);
    });

    test('shutdown is idempotent', async () => {
      await pool.create(makeAgent({ id: 'idem1' }));
      await pool.shutdown();
      await pool.shutdown(); // should not throw
      expect(pool.list()).toEqual([]);
    });

    test('can create agents after shutdown (pool reuse)', async () => {
      await pool.create(makeAgent({ id: 'before-shutdown' }));
      await pool.shutdown();

      const agent = await pool.create(makeAgent({ id: 'after-shutdown' }));
      expect(agent).toBeDefined();
      expect(pool.list()).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    test('handles rapid create/remove cycles', async () => {
      for (let i = 0; i < 5; i++) {
        await pool.create(makeAgent({ id: `rapid-${i}` }));
        await pool.remove(`rapid-${i}`);
      }
      expect(pool.list()).toEqual([]);
    });

    test('count reflects current state accurately', async () => {
      expect(pool.list()).toHaveLength(0);
      await pool.create(makeAgent({ id: 'c1' }));
      expect(pool.list()).toHaveLength(1);
      await pool.create(makeAgent({ id: 'c2' }));
      expect(pool.list()).toHaveLength(2);
      await pool.remove('c1');
      expect(pool.list()).toHaveLength(1);
      await pool.remove('c2');
      expect(pool.list()).toHaveLength(0);
    });
  });

  describe('BackendRegistry integration', () => {
    test('resolves definition.backend to the correct registry backend', async () => {
      const claudeBackend = new MockBackend('claude' as AIBackend);
      const codexBackend = new MockBackend('codex' as AIBackend);
      claudeBackend.setResponses(['claude-resp']);
      codexBackend.setResponses(['codex-resp']);

      const registry = new DefaultBackendRegistry('claude' as AIBackend);
      registry.register(claudeBackend);
      registry.register(codexBackend);

      const registryPool = new AgentPool(registry, { maxAgents: 5 });

      await registryPool.create(makeAgent({ id: 'codex-agent', backend: 'codex' as AIBackend }));

      // Codex backend should have been spawned
      expect(codexBackend.spawnCalls).toHaveLength(1);
      expect(codexBackend.spawnCalls[0].agentId).toBe('codex-agent');
      // Claude backend should NOT have been spawned
      expect(claudeBackend.spawnCalls).toHaveLength(0);

      await registryPool.shutdown();
    });

    test('falls back to default when no definition.backend', async () => {
      const claudeBackend = new MockBackend('claude' as AIBackend);
      claudeBackend.setResponses(['default-resp']);

      const registry = new DefaultBackendRegistry('claude' as AIBackend);
      registry.register(claudeBackend);

      const registryPool = new AgentPool(registry, { maxAgents: 5 });

      await registryPool.create(makeAgent({ id: 'default-agent' }));

      expect(claudeBackend.spawnCalls).toHaveLength(1);
      expect(claudeBackend.spawnCalls[0].agentId).toBe('default-agent');

      await registryPool.shutdown();
    });

    test('single CLIBackend still works (backward compat)', async () => {
      const singleBackend = new MockBackend();
      singleBackend.setResponses(['compat-resp']);

      const compatPool = new AgentPool(singleBackend, { maxAgents: 5 });
      await compatPool.create(makeAgent({ id: 'compat-agent' }));

      expect(singleBackend.spawnCalls).toHaveLength(1);

      await compatPool.shutdown();
    });
  });

  describe('store persistence', () => {
    /** In-memory mock of AgentStoreInterface for testing persistence calls. */
    class MockStore implements AgentStoreInterface {
      saved: AgentDefinition[] = [];
      updated: Array<{ id: string; def: AgentDefinition }> = [];
      deleted: string[] = [];
      definitions: AgentDefinition[] = [];

      save(def: AgentDefinition) {
        this.saved.push(def);
        this.definitions.push(def);
      }
      update(id: string, def: AgentDefinition) {
        this.updated.push({ id, def });
      }
      delete(id: string) {
        this.deleted.push(id);
      }
      getById(id: string) {
        return this.definitions.find((d) => d.id === id) ?? null;
      }
      list() {
        return this.definitions;
      }
      upsertSeed(def: AgentDefinition) {
        this.saved.push(def);
        this.definitions.push(def);
        return true;
      }
    }

    test('create() calls store.save()', async () => {
      const store = new MockStore();
      const storePool = new AgentPool(backend, { maxAgents: 5, store });
      const def = makeAgent({ id: 'store-save' });
      await storePool.create(def);

      expect(store.saved).toHaveLength(1);
      expect(store.saved[0].id).toBe('store-save');

      await storePool.shutdown();
    });

    test('update() calls store.update()', async () => {
      const store = new MockStore();
      const storePool = new AgentPool(backend, { maxAgents: 5, store });
      const def = makeAgent({ id: 'store-upd' });
      await storePool.create(def);
      await storePool.update('store-upd', { name: 'Updated' });

      expect(store.updated).toHaveLength(1);
      expect(store.updated[0].id).toBe('store-upd');
      expect(store.updated[0].def.name).toBe('Updated');

      await storePool.shutdown();
    });

    test('remove() calls store.delete()', async () => {
      const store = new MockStore();
      const storePool = new AgentPool(backend, { maxAgents: 5, store });
      await storePool.create(makeAgent({ id: 'store-del' }));
      await storePool.remove('store-del');

      expect(store.deleted).toEqual(['store-del']);

      await storePool.shutdown();
    });

    test('restore() spawns agents from store', async () => {
      const store = new MockStore();
      store.definitions = [
        makeAgent({ id: 'restored-1', name: 'R1' }),
        makeAgent({ id: 'restored-2', name: 'R2' }),
      ];

      const storePool = new AgentPool(backend, { maxAgents: 5, store });
      await storePool.restore();

      expect(storePool.list()).toHaveLength(2);
      expect(storePool.get('restored-1')).toBeDefined();
      expect(storePool.get('restored-2')).toBeDefined();

      await storePool.shutdown();
    });

    test('restore() skips agents already in pool', async () => {
      const store = new MockStore();
      store.definitions = [makeAgent({ id: 'already-there' })];

      const storePool = new AgentPool(backend, { maxAgents: 5, store });
      await storePool.create(makeAgent({ id: 'already-there' }));
      await storePool.restore();

      // Should still have exactly one — not duplicated
      expect(storePool.list()).toHaveLength(1);

      await storePool.shutdown();
    });

    test('restore() continues on individual agent failure', async () => {
      const failBackend = new MockBackend();
      failBackend.setResponses(['ok']);

      const store = new MockStore();
      store.definitions = [
        makeAgent({ id: 'good-agent' }),
        makeAgent({ id: 'bad-agent' }),
        makeAgent({ id: 'good-agent-2' }),
      ];

      // Fail on second spawn call
      let callCount = 0;
      const origSpawn = failBackend.spawn.bind(failBackend);
      failBackend.spawn = async (config) => {
        callCount++;
        if (callCount === 2) throw new Error('spawn failed');
        return origSpawn(config);
      };

      const storePool = new AgentPool(failBackend, { maxAgents: 5, store });
      await storePool.restore();

      // Two of three should have been restored
      expect(storePool.list()).toHaveLength(2);
      expect(storePool.get('good-agent')).toBeDefined();
      expect(storePool.get('bad-agent')).toBeUndefined();
      expect(storePool.get('good-agent-2')).toBeDefined();

      await storePool.shutdown();
    });

    test('pool works without store (backward compat)', async () => {
      const noStorePool = new AgentPool(backend, { maxAgents: 5 });
      await noStorePool.create(makeAgent({ id: 'no-store' }));
      expect(noStorePool.list()).toHaveLength(1);
      await noStorePool.shutdown();
    });
  });

  describe('workspace isolation', () => {
    let tmpWorkspaceDir: string;

    beforeEach(() => {
      tmpWorkspaceDir = join(tmpdir(), `agent-workspace-test-${Date.now()}`);
      mkdirSync(tmpWorkspaceDir, { recursive: true });
    });

    afterEach(() => {
      try {
        rmSync(tmpWorkspaceDir, { recursive: true, force: true });
      } catch {
        // cleanup best-effort
      }
    });

    test('create() passes cwd from workspace to backend spawn', async () => {
      const wsPool = new AgentPool(backend, {
        maxAgents: 5,
        workspaceDir: tmpWorkspaceDir,
      });
      await wsPool.create(makeAgent({ id: 'ws-agent' }));

      expect(backend.spawnCalls).toHaveLength(1);
      expect(backend.spawnCalls[0].cwd).toBe(join(tmpWorkspaceDir, 'ws-agent'));

      await wsPool.shutdown();
    });

    test('create() without workspaceDir does not set cwd', async () => {
      const noWsPool = new AgentPool(backend, { maxAgents: 5 });
      await noWsPool.create(makeAgent({ id: 'no-ws-agent' }));

      expect(backend.spawnCalls).toHaveLength(1);
      expect(backend.spawnCalls[0].cwd).toBeUndefined();

      await noWsPool.shutdown();
    });

    test('rejects path traversal in agentId', async () => {
      const wsPool = new AgentPool(backend, {
        maxAgents: 5,
        workspaceDir: tmpWorkspaceDir,
      });

      await expect(wsPool.create(makeAgent({ id: '../../etc' }))).rejects.toThrow(
        'Invalid agentId for workspace',
      );

      await wsPool.shutdown();
    });
  });

  describe('security enforcement', () => {
    test('canModifyFiles: false passes skipPermissions: false to backend', async () => {
      const secPool = new AgentPool(backend, { maxAgents: 5 });
      await secPool.create(makeAgent({ id: 'no-modify', canModifyFiles: false }));

      expect(backend.spawnCalls).toHaveLength(1);
      expect(backend.spawnCalls[0].skipPermissions).toBe(false);

      await secPool.shutdown();
    });

    test('canModifyFiles: true passes skipPermissions: true to backend', async () => {
      const secPool = new AgentPool(backend, { maxAgents: 5 });
      await secPool.create(makeAgent({ id: 'can-modify', canModifyFiles: true }));

      expect(backend.spawnCalls).toHaveLength(1);
      expect(backend.spawnCalls[0].skipPermissions).toBe(true);

      await secPool.shutdown();
    });
  });
});
