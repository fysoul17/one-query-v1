import { describe, expect, test } from 'bun:test';
import type { Conductor } from '@autonomy/conductor';
import type { MemoryInterface } from '@pyx-memory/client';
import { DisabledMemory } from '../src/disabled-memory.ts';
import { createHealthRoute } from '../src/routes/health.ts';
import { createMemoryRoutes } from '../src/routes/memory.ts';
import { MockConductor } from './helpers/mock-conductor.ts';

describe('DisabledMemory — health route integration', () => {
  test('health route returns ok status with memoryStatus disabled', async () => {
    const memory = new DisabledMemory();
    const conductor = new MockConductor();
    await conductor.initialize();

    const handler = createHealthRoute(
      conductor as unknown as Conductor,
      memory as unknown as MemoryInterface,
      Date.now(),
    );
    const res = await handler();
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.memoryStatus).toBe('disabled');
  });
});

describe('DisabledMemory — memory route integration', () => {
  test('search returns empty results', async () => {
    const memory = new DisabledMemory();
    const routes = createMemoryRoutes(memory as unknown as MemoryInterface);

    const req = new Request('http://localhost/api/memory/search?query=hello');
    const res = await routes.search(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.entries).toEqual([]);
    expect(body.data.totalCount).toBe(0);
  });

  test('ingest stores and returns entry', async () => {
    const memory = new DisabledMemory();
    const routes = createMemoryRoutes(memory as unknown as MemoryInterface);

    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({ content: 'Some info', metadata: {} }),
    });
    const res = await routes.ingest(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
  });

  test('stats returns zero values', async () => {
    const memory = new DisabledMemory();
    const routes = createMemoryRoutes(memory as unknown as MemoryInterface);

    const req = new Request('http://localhost/api/memory/stats');
    const res = await routes.stats(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.totalEntries).toBe(0);
    expect(body.data.vectorCount).toBe(0);
    expect(body.data.connected).toBe(false);
  });

  test('entries returns empty list', async () => {
    const memory = new DisabledMemory();
    const routes = createMemoryRoutes(memory as unknown as MemoryInterface);

    const req = new Request('http://localhost/api/memory/entries');
    const res = await routes.entries(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.entries).toEqual([]);
    expect(body.data.totalCount).toBe(0);
  });

  test('get entry returns 404', async () => {
    const memory = new DisabledMemory();
    const routes = createMemoryRoutes(memory as unknown as MemoryInterface);

    const req = new Request('http://localhost/api/memory/some-id');
    await expect(routes.getEntry(req, { id: 'some-id' })).rejects.toThrow();
  });

  test('clearSession returns 0 cleared', async () => {
    const memory = new DisabledMemory();
    const routes = createMemoryRoutes(memory as unknown as MemoryInterface);

    const req = new Request('http://localhost/api/memory/sessions/sess-1', {
      method: 'DELETE',
    });
    const res = await routes.clearSession(req, { sessionId: 'sess-1' });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.cleared).toBe(0);
  });
});
