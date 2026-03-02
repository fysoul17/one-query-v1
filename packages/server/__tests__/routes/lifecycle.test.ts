import { beforeEach, describe, expect, test } from 'bun:test';
import type { MemoryInterface } from '@pyx-memory/client';
import { BadRequestError, NotImplementedError } from '../../src/errors.ts';
import { createLifecycleRoutes, isExtended } from '../../src/routes/lifecycle.ts';
import { MockExtendedMemory, MockMemory } from '../helpers/mock-memory.ts';

describe('isExtended() type guard', () => {
  test('returns false for base MemoryInterface', () => {
    const memory = new MockMemory();
    expect(isExtended(memory as unknown as MemoryInterface)).toBe(false);
  });

  test('returns true for ExtendedMemoryInterface', () => {
    const memory = new MockExtendedMemory();
    expect(isExtended(memory as unknown as MemoryInterface)).toBe(true);
  });
});

describe('Lifecycle routes — non-extended memory (501)', () => {
  let routes: ReturnType<typeof createLifecycleRoutes>;

  beforeEach(() => {
    const memory = new MockMemory();
    routes = createLifecycleRoutes(memory as unknown as MemoryInterface);
  });

  test('consolidate throws NotImplementedError', () => {
    expect(() => routes.consolidate()).toThrow(NotImplementedError);
  });

  test('forget throws NotImplementedError', () => {
    expect(() => routes.forget(new Request('http://localhost'), { id: '1' })).toThrow(
      NotImplementedError,
    );
  });

  test('summarizeSession throws NotImplementedError', () => {
    expect(() =>
      routes.summarizeSession(new Request('http://localhost'), { sessionId: 's1' }),
    ).toThrow(NotImplementedError);
  });

  test('decay throws NotImplementedError', () => {
    expect(() => routes.decay()).toThrow(NotImplementedError);
  });

  test('reindex throws NotImplementedError', () => {
    expect(() => routes.reindex()).toThrow(NotImplementedError);
  });

  test('deleteBySource throws NotImplementedError', () => {
    expect(() =>
      routes.deleteBySource(new Request('http://localhost'), { source: 'test' }),
    ).toThrow(NotImplementedError);
  });
});

describe('Lifecycle routes — extended memory', () => {
  let memory: MockExtendedMemory;
  let routes: ReturnType<typeof createLifecycleRoutes>;

  beforeEach(() => {
    memory = new MockExtendedMemory();
    routes = createLifecycleRoutes(memory as unknown as MemoryInterface);
  });

  describe('POST /api/lifecycle/consolidate', () => {
    test('returns consolidation result', async () => {
      const res = await routes.consolidate();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.entriesProcessed).toBe(10);
      expect(body.data.entriesMerged).toBe(2);
      expect(body.data.entriesArchived).toBe(1);
      expect(memory.consolidateCalls).toBe(1);
    });

    test('propagates error from consolidate', async () => {
      memory.consolidate = async () => {
        throw new Error('consolidation failed');
      };
      await expect(routes.consolidate()).rejects.toThrow('consolidation failed');
    });
  });

  describe('POST /api/lifecycle/forget/:id', () => {
    test('forgets memory entry by id', async () => {
      const req = new Request('http://localhost/api/lifecycle/forget/mem-1', {
        method: 'POST',
        body: JSON.stringify({ reason: 'outdated' }),
      });
      const res = await routes.forget(req, { id: 'mem-1' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.forgotten).toBe(true);
      expect(memory.forgetCalls[0]).toEqual({ id: 'mem-1', reason: 'outdated' });
    });

    test('throws BadRequestError when id is missing', async () => {
      const req = new Request('http://localhost/api/lifecycle/forget/', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await expect(routes.forget(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });

    test('propagates error from forget', async () => {
      memory.forget = async () => {
        throw new Error('forget failed');
      };
      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await expect(routes.forget(req, { id: '1' })).rejects.toThrow('forget failed');
    });
  });

  describe('POST /api/lifecycle/summarize-session/:sessionId', () => {
    test('summarizes session and returns entry', async () => {
      const req = new Request('http://localhost');
      const res = await routes.summarizeSession(req, { sessionId: 'sess-1' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.id).toBe('summary-1');
      expect(body.data.content).toContain('sess-1');
      expect(memory.summarizeSessionCalls).toContain('sess-1');
    });

    test('throws BadRequestError when sessionId is missing', async () => {
      const req = new Request('http://localhost');
      await expect(routes.summarizeSession(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });

    test('propagates error from summarizeSession', async () => {
      memory.summarizeSession = async () => {
        throw new Error('summarize failed');
      };
      const req = new Request('http://localhost');
      await expect(routes.summarizeSession(req, { sessionId: 's1' })).rejects.toThrow(
        'summarize failed',
      );
    });
  });

  describe('POST /api/lifecycle/decay', () => {
    test('runs decay and returns archived count', async () => {
      const res = await routes.decay();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.archivedCount).toBe(3);
      expect(memory.decayCalls).toBe(1);
    });

    test('propagates error from runDecay', async () => {
      memory.runDecay = async () => {
        throw new Error('decay failed');
      };
      await expect(routes.decay()).rejects.toThrow('decay failed');
    });
  });

  describe('POST /api/lifecycle/reindex', () => {
    test('reindexes and returns success', async () => {
      const res = await routes.reindex();
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.reindexed).toBe(true);
      expect(memory.reindexCalls).toBe(1);
    });

    test('propagates error from reindex', async () => {
      memory.reindex = async () => {
        throw new Error('reindex failed');
      };
      await expect(routes.reindex()).rejects.toThrow('reindex failed');
    });
  });

  describe('DELETE /api/lifecycle/source/:source', () => {
    test('deletes entries by source and returns count', async () => {
      const req = new Request('http://localhost');
      const res = await routes.deleteBySource(req, { source: 'file%3A%2F%2Ftest.txt' });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.deletedCount).toBe(5);
      expect(memory.deleteBySourceCalls[0]).toBe('file://test.txt');
    });

    test('throws BadRequestError when source is missing', async () => {
      const req = new Request('http://localhost');
      await expect(routes.deleteBySource(req, {})).rejects.toBeInstanceOf(BadRequestError);
    });

    test('propagates error from deleteBySource', async () => {
      memory.deleteBySource = async () => {
        throw new Error('delete failed');
      };
      const req = new Request('http://localhost');
      await expect(routes.deleteBySource(req, { source: 'test' })).rejects.toThrow('delete failed');
    });
  });
});
