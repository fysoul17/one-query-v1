import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentPool } from '@autonomy/agent-manager';
import type { Conductor } from '@autonomy/conductor';
import { AgentOwner } from '@autonomy/shared';
import { BadRequestError, NotFoundError } from '../../src/errors.ts';
import { createAgentRoutes } from '../../src/routes/agents.ts';
import { MockConductor } from '../helpers/mock-conductor.ts';
import { MockPool, makeDefinition } from '../helpers/mock-pool.ts';

describe('Agent routes', () => {
  let conductor: MockConductor;
  let pool: MockPool;
  let routes: ReturnType<typeof createAgentRoutes>;

  beforeEach(() => {
    conductor = new MockConductor();
    conductor.initialized = true;
    pool = new MockPool();
    routes = createAgentRoutes(conductor as unknown as Conductor, pool as unknown as AgentPool);
  });

  describe('GET /api/agents (list)', () => {
    test('returns empty array when no agents', async () => {
      const res = await routes.list();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    test('returns agents from conductor', async () => {
      await conductor.createAgent({ name: 'A1', role: 'test', systemPrompt: 'test' });
      const res = await routes.list();
      const body = await res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe('A1');
    });
  });

  describe('POST /api/agents (create)', () => {
    test('creates agent with owner USER via pool', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: 'My Agent',
          role: 'assistant',
          systemPrompt: 'Help users',
          tools: ['read', 'write'],
          persistent: true,
        }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('My Agent');
      expect(body.data.owner).toBe(AgentOwner.USER);

      // Verify pool.create was called, not conductor.createAgent
      expect(pool.createCalls.length).toBe(1);
      expect(pool.createCalls[0]?.owner).toBe(AgentOwner.USER);
      expect(conductor.createAgentCalls.length).toBe(0);
    });

    test('throws BadRequestError when name is missing', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({ role: 'assistant', systemPrompt: 'test' }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when role is missing', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', systemPrompt: 'test' }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when systemPrompt is missing', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', role: 'assistant' }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('POST /api/agents — session fields', () => {
    test('persistent agent gets sessionId', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Persistent',
          role: 'worker',
          systemPrompt: 'Test',
          persistent: true,
        }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(body.data.sessionId).toBeDefined();
      expect(typeof body.data.sessionId).toBe('string');
    });

    test('ephemeral agent gets no sessionId', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Ephemeral',
          role: 'worker',
          systemPrompt: 'Test',
          persistent: false,
        }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(body.data.sessionId).toBeUndefined();
    });
  });

  describe('POST /api/agents — backend validation', () => {
    test('accepts valid backend field', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Claude Agent',
          role: 'worker',
          systemPrompt: 'Test',
          persistent: false,
          backend: 'claude',
        }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.backend).toBe('claude');
    });

    test('rejects invalid backend with 400', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Bad Agent',
          role: 'worker',
          systemPrompt: 'Test',
          persistent: false,
          backend: 'invalid-backend',
        }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('succeeds without backend field (uses default)', async () => {
      const req = new Request('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Default Agent',
          role: 'worker',
          systemPrompt: 'Test',
          persistent: false,
        }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.name).toBe('Default Agent');
    });
  });

  describe('PUT /api/agents/:id (update)', () => {
    test('updates existing agent', async () => {
      const def = makeDefinition({ id: 'agent-1', name: 'Original' });
      pool.addAgent(def);

      const req = new Request('http://localhost/api/agents/agent-1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Renamed' }),
      });
      const res = await routes.update(req, { id: 'agent-1' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Renamed');
      expect(pool.updateCalls.length).toBe(1);
      expect(pool.updateCalls[0]?.updates.name).toBe('Renamed');
    });

    test('throws NotFoundError for non-existent agent', async () => {
      const req = new Request('http://localhost/api/agents/nope', {
        method: 'PUT',
        body: JSON.stringify({ name: 'X' }),
      });
      await expect(routes.update(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });

    test('preserves fields not in update', async () => {
      const def = makeDefinition({
        id: 'agent-1',
        name: 'Original',
        role: 'worker',
        systemPrompt: 'Do stuff',
      });
      pool.addAgent(def);

      const req = new Request('http://localhost/api/agents/agent-1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'NewName' }),
      });
      const res = await routes.update(req, { id: 'agent-1' });
      const body = await res.json();

      expect(body.data.name).toBe('NewName');
      expect(body.data.role).toBe('worker');
    });

    test('rejects invalid backend', async () => {
      const def = makeDefinition({ id: 'agent-1' });
      pool.addAgent(def);

      const req = new Request('http://localhost/api/agents/agent-1', {
        method: 'PUT',
        body: JSON.stringify({ backend: 'invalid-backend' }),
      });
      await expect(routes.update(req, { id: 'agent-1' })).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('DELETE /api/agents/:id (remove)', () => {
    test('deletes existing agent', async () => {
      const def = makeDefinition({ id: 'agent-1' });
      pool.addAgent(def);

      const req = new Request('http://localhost/api/agents/agent-1', { method: 'DELETE' });
      const res = await routes.remove(req, { id: 'agent-1' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe('agent-1');
      // API-initiated delete uses pool.remove() directly (user is authorizing)
      expect(pool.removeCalls).toContain('agent-1');
    });

    test('throws NotFoundError for non-existent agent', async () => {
      const req = new Request('http://localhost/api/agents/nope', { method: 'DELETE' });
      await expect(routes.remove(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('POST /api/agents/:id/restart', () => {
    test('restarts existing agent', async () => {
      const def = makeDefinition({ id: 'agent-1' });
      const process = pool.addAgent(def);

      const req = new Request('http://localhost/api/agents/agent-1/restart', { method: 'POST' });
      const res = await routes.restart(req, { id: 'agent-1' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(process.restartCalls).toBe(1);
    });

    test('throws NotFoundError for non-existent agent', async () => {
      const req = new Request('http://localhost/api/agents/nope/restart', { method: 'POST' });
      await expect(routes.restart(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
