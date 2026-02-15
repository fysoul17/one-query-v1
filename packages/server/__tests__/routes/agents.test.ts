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

  describe('PUT /api/agents/:id (update)', () => {
    test('returns 501 not implemented', async () => {
      const req = new Request('http://localhost/api/agents/abc', { method: 'PUT' });
      const res = await routes.update(req, { id: 'abc' });
      expect(res.status).toBe(501);
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
      expect(conductor.deleteAgentCalls).toContain('agent-1');
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
