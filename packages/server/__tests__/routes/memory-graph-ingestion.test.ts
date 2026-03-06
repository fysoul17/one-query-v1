import { beforeEach, describe, expect, test } from 'bun:test';
import type { MemoryInterface } from '@autonomy/shared';
import { createMemoryRoutes } from '../../src/routes/memory.ts';
import { MockMemory } from '../helpers/mock-memory.ts';

/**
 * Tests that the ingest route forwards all MemoryIngestRequest fields
 * (including graph-related fields) to memory.store().
 */

describe('Ingest route — graph field forwarding', () => {
  let memory: MockMemory;
  let routes: ReturnType<typeof createMemoryRoutes>;

  beforeEach(() => {
    memory = new MockMemory();
    routes = createMemoryRoutes(memory as unknown as MemoryInterface);
  });

  test('forwards targets field to memory.store()', async () => {
    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Alice works at Acme',
        targets: ['sqlite', 'vector', 'graph'],
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].targets).toEqual(['sqlite', 'vector', 'graph']);
  });

  test('forwards entities field to memory.store()', async () => {
    const entities = [
      { name: 'Alice', type: 'PERSON' },
      { name: 'Acme', type: 'ORGANIZATION' },
    ];

    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Alice works at Acme',
        targets: ['sqlite', 'vector', 'graph'],
        entities,
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].entities).toEqual(entities);
  });

  test('forwards relationships field to memory.store()', async () => {
    const entities = [
      { name: 'Alice', type: 'PERSON' },
      { name: 'Acme', type: 'ORGANIZATION' },
    ];
    const relationships = [{ source: 'Alice', target: 'Acme', type: 'WORKS_AT' }];

    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Alice works at Acme',
        targets: ['sqlite', 'vector', 'graph'],
        entities,
        relationships,
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].relationships).toEqual(relationships);
  });

  test('forwards importance field to memory.store()', async () => {
    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Critical info',
        importance: 9,
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].importance).toBe(9);
  });

  test('forwards source field to memory.store()', async () => {
    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Data from file',
        source: 'report.pdf',
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].source).toBe('report.pdf');
  });

  test('forwards agentId and sessionId to memory.store()', async () => {
    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Agent-scoped data',
        agentId: 'agent-42',
        sessionId: 'sess-99',
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].agentId).toBe('agent-42');
    expect(memory.storeCalls[0].sessionId).toBe('sess-99');
  });

  test('forwards eventTime field to memory.store()', async () => {
    const eventTime = '2026-01-15T10:00:00Z';
    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Historical event',
        eventTime,
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].eventTime).toBe(eventTime);
  });

  test('forwards id and parentId to memory.store()', async () => {
    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Child chunk',
        id: 'chunk-3',
        parentId: 'doc-1',
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].id).toBe('chunk-3');
    expect(memory.storeCalls[0].parentId).toBe('doc-1');
  });

  test('forwards ALL MemoryIngestRequest fields together', async () => {
    const fullRequest = {
      content: 'Alice works at Acme Corp on the AI project',
      type: 'long-term',
      metadata: { domain: 'work' },
      agentId: 'agent-1',
      sessionId: 'sess-1',
      targets: ['sqlite', 'vector', 'graph'],
      entities: [
        { name: 'Alice', type: 'PERSON' },
        { name: 'Acme Corp', type: 'ORGANIZATION' },
        { name: 'AI project', type: 'PROJECT' },
      ],
      relationships: [
        { source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' },
        { source: 'Alice', target: 'AI project', type: 'CONTRIBUTES_TO' },
      ],
      importance: 8,
      source: 'conversation',
      eventTime: '2026-03-01T09:00:00Z',
      id: 'custom-id-1',
      parentId: 'parent-doc',
      ingestTime: '2026-03-01T09:01:00Z',
    };

    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify(fullRequest),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    const stored = memory.storeCalls[0];

    expect(stored.content).toBe(fullRequest.content);
    expect(stored.type).toBe('long-term');
    expect(stored.metadata).toEqual({ domain: 'work' });

    expect(stored.targets).toEqual(['sqlite', 'vector', 'graph']);
    expect(stored.entities).toEqual(fullRequest.entities);
    expect(stored.relationships).toEqual(fullRequest.relationships);
    expect(stored.importance).toBe(8);
    expect(stored.source).toBe('conversation');
    expect(stored.eventTime).toBe('2026-03-01T09:00:00Z');
    expect(stored.id).toBe('custom-id-1');
    expect(stored.parentId).toBe('parent-doc');
    expect(stored.ingestTime).toBe('2026-03-01T09:01:00Z');
    expect(stored.agentId).toBe('agent-1');
    expect(stored.sessionId).toBe('sess-1');
  });

  test('does not forward fields that are not in MemoryIngestRequest', async () => {
    const req = new Request('http://localhost/api/memory/ingest', {
      method: 'POST',
      body: JSON.stringify({
        content: 'test',
        dangerousField: 'should not pass through',
        __proto__: { admin: true },
      }),
    });

    await routes.ingest(req);

    expect(memory.storeCalls).toHaveLength(1);
    const stored = memory.storeCalls[0] as Record<string, unknown>;
    expect(stored.dangerousField).toBeUndefined();
  });
});
