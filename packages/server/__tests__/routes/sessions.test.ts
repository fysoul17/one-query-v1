import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { MemoryInterface } from '@pyx-memory/client';
import { BadRequestError, NotFoundError } from '../../src/errors.ts';
import { createSessionRoutes } from '../../src/routes/sessions.ts';
import { SessionStore } from '../../src/session-store.ts';
import { MockMemory, MockExtendedMemory } from '../helpers/mock-memory.ts';

describe('Session routes', () => {
  let db: Database;
  let store: SessionStore;
  let memory: MockMemory;
  let routes: ReturnType<typeof createSessionRoutes>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    store = new SessionStore(db);
    memory = new MockMemory();
    routes = createSessionRoutes(store, memory as unknown as MemoryInterface);
  });

  describe('GET /api/sessions (list)', () => {
    test('returns empty list', async () => {
      const req = new Request('http://localhost/api/sessions');
      const res = await routes.list(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.sessions).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    test('returns sessions', async () => {
      store.create({ title: 'Session 1' });
      store.create({ title: 'Session 2' });

      const req = new Request('http://localhost/api/sessions');
      const res = await routes.list(req);
      const body = await res.json();

      expect(body.data.sessions.length).toBe(2);
      expect(body.data.total).toBe(2);
    });

    test('filters by agentId query param', async () => {
      store.create({ agentId: 'agent-1' });
      store.create({ agentId: 'agent-2' });

      const req = new Request('http://localhost/api/sessions?agentId=agent-1');
      const res = await routes.list(req);
      const body = await res.json();

      expect(body.data.sessions.length).toBe(1);
      expect(body.data.sessions[0].agentId).toBe('agent-1');
    });

    test('supports pagination query params', async () => {
      for (let i = 0; i < 5; i++) {
        store.create({ title: `S${i}` });
      }

      const req = new Request('http://localhost/api/sessions?page=2&limit=2');
      const res = await routes.list(req);
      const body = await res.json();

      expect(body.data.sessions.length).toBe(2);
      expect(body.data.page).toBe(2);
      expect(body.data.limit).toBe(2);
      expect(body.data.total).toBe(5);
    });
  });

  describe('POST /api/sessions (create)', () => {
    test('creates session with title', async () => {
      const req = new Request('http://localhost/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: 'My Session' }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('My Session');
    });

    test('creates session with default title', async () => {
      const req = new Request('http://localhost/api/sessions', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.title).toBe('New Session');
    });

    test('creates session with agentId', async () => {
      const req = new Request('http://localhost/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: 'Agent Chat', agentId: 'agent-1' }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(body.data.agentId).toBe('agent-1');
    });
  });

  describe('GET /api/sessions/:id (get)', () => {
    test('returns session detail with messages', async () => {
      const session = store.create({ title: 'Detail' });
      store.addMessage(session.id, 'user', 'Hello');

      const req = new Request(`http://localhost/api/sessions/${session.id}`);
      const res = await routes.get(req, { id: session.id });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Detail');
      expect(body.data.messages.length).toBe(1);
      expect(body.data.messages[0].content).toBe('Hello');
    });

    test('throws NotFoundError for missing session', async () => {
      const req = new Request('http://localhost/api/sessions/nope');
      await expect(routes.get(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });

    test('throws BadRequestError when id param is missing', async () => {
      const req = new Request('http://localhost/api/sessions/');
      await expect(routes.get(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('PUT /api/sessions/:id (update)', () => {
    test('updates session title', async () => {
      const session = store.create({ title: 'Old Title' });

      const req = new Request(`http://localhost/api/sessions/${session.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: 'New Title' }),
      });
      const res = await routes.update(req, { id: session.id });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.title).toBe('New Title');
    });

    test('throws NotFoundError for missing session', async () => {
      const req = new Request('http://localhost/api/sessions/nope', {
        method: 'PUT',
        body: JSON.stringify({ title: 'X' }),
      });
      await expect(routes.update(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });

    test('throws BadRequestError when title is missing', async () => {
      const session = store.create({});
      const req = new Request(`http://localhost/api/sessions/${session.id}`, {
        method: 'PUT',
        body: JSON.stringify({}),
      });
      await expect(routes.update(req, { id: session.id })).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('DELETE /api/sessions/:id (remove)', () => {
    test('deletes session and clears memory', async () => {
      const session = store.create({ title: 'To Delete' });

      const req = new Request(`http://localhost/api/sessions/${session.id}`, {
        method: 'DELETE',
      });
      const res = await routes.remove(req, { id: session.id });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(session.id);
      expect(store.getById(session.id)).toBeNull();
      expect(memory.clearSessionCalls).toContain(session.id);
    });

    test('throws NotFoundError for missing session', async () => {
      const req = new Request('http://localhost/api/sessions/nope', { method: 'DELETE' });
      await expect(routes.remove(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });

    test('still succeeds if memory.clearSession fails', async () => {
      const session = store.create({});

      // Make clearSession throw
      memory.clearSession = async () => {
        throw new Error('memory error');
      };

      const req = new Request(`http://localhost/api/sessions/${session.id}`, {
        method: 'DELETE',
      });
      const res = await routes.remove(req, { id: session.id });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(session.id);
    });
  });
});

describe('Session routes — extended memory (summarization)', () => {
  let db: Database;
  let store: SessionStore;
  let extMemory: MockExtendedMemory;
  let routes: ReturnType<typeof createSessionRoutes>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    store = new SessionStore(db);
    extMemory = new MockExtendedMemory();
    routes = createSessionRoutes(store, extMemory as unknown as MemoryInterface);
  });

  test('session delete calls summarizeSession when memory supports it', async () => {
    const session = store.create({ title: 'Summarize Me' });

    const req = new Request(`http://localhost/api/sessions/${session.id}`, {
      method: 'DELETE',
    });
    const res = await routes.remove(req, { id: session.id });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(session.id);
    expect(extMemory.summarizeSessionCalls).toContain(session.id);
    expect(extMemory.clearSessionCalls).toContain(session.id);
  });

  test('session delete succeeds even when summarizeSession throws', async () => {
    const session = store.create({ title: 'Fail Summarize' });

    extMemory.summarizeSession = async () => {
      throw new Error('summarize exploded');
    };

    const req = new Request(`http://localhost/api/sessions/${session.id}`, {
      method: 'DELETE',
    });
    const res = await routes.remove(req, { id: session.id });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(session.id);
    // clearSession should still have been called despite summarize failure
    expect(extMemory.clearSessionCalls).toContain(session.id);
  });
});
