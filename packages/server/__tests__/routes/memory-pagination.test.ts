import { beforeEach, describe, expect, test } from 'bun:test';
import type { MemoryInterface } from '@pyx-memory/client';
import { BadRequestError } from '../../src/errors.ts';
import { createMemoryRoutes } from '../../src/routes/memory.ts';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function makeEntry(id: string, index = 0) {
  return {
    id,
    content: `content for ${id}`,
    type: 'long-term' as const,
    metadata: {},
    createdAt: new Date(BASE_TIME + index * 1000).toISOString(),
  };
}

class MockMemoryWithList {
  private _allEntries: ReturnType<typeof makeEntry>[] = [];
  listCalls: Array<Record<string, unknown>> = [];
  searchCalls: Array<Record<string, unknown>> = [];

  seed(count: number) {
    this._allEntries = Array.from({ length: count }, (_, i) =>
      makeEntry(`entry-${String(i).padStart(3, '0')}`, i),
    );
  }

  async list(params: { page?: number; limit?: number; type?: string; agentId?: string } = {}) {
    this.listCalls.push(params as Record<string, unknown>);
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const offset = (page - 1) * limit;
    const entries = this._allEntries.slice(offset, offset + limit);
    return { entries, totalCount: this._allEntries.length, page, limit };
  }

  async search(params: Record<string, unknown>) {
    this.searchCalls.push(params);
    return { entries: this._allEntries, totalCount: this._allEntries.length, strategy: 'naive' };
  }

  // biome-ignore lint/suspicious/noExplicitAny: test mock
  async store(entry: any) {
    return { id: 'new', ...entry, createdAt: new Date().toISOString() };
  }

  async get(id: string) {
    return this._allEntries.find((e) => e.id === id) ?? null;
  }

  async delete(id: string) {
    return this._allEntries.some((e) => e.id === id);
  }

  async clearSession(_sessionId: string) {
    return 0;
  }

  async stats() {
    return {
      totalEntries: this._allEntries.length,
      storageUsedBytes: 0,
      vectorCount: 0,
      recentAccessCount: 0,
    };
  }
}

describe('agent-forge Memory routes — entries with proper list() pagination', () => {
  let memory: MockMemoryWithList;
  let routes: ReturnType<typeof createMemoryRoutes>;

  beforeEach(() => {
    memory = new MockMemoryWithList();
    routes = createMemoryRoutes(memory as unknown as MemoryInterface);
  });

  describe('route uses list() not search()', () => {
    test('entries route calls list() not search()', async () => {
      memory.seed(10);
      const req = new Request('http://localhost/api/memory/entries');
      await routes.entries(req);

      expect(memory.listCalls).toHaveLength(1);
      expect(memory.searchCalls).toHaveLength(0);
    });
  });

  describe('page / limit forwarding', () => {
    test('default call passes page=1, limit=20', async () => {
      memory.seed(10);
      await routes.entries(new Request('http://localhost/api/memory/entries'));
      expect(memory.listCalls[0]?.page).toBe(1);
      expect(memory.listCalls[0]?.limit).toBe(20);
    });

    test('page=2, limit=3 is forwarded to list()', async () => {
      memory.seed(10);
      await routes.entries(new Request('http://localhost/api/memory/entries?page=2&limit=3'));
      expect(memory.listCalls[0]?.page).toBe(2);
      expect(memory.listCalls[0]?.limit).toBe(3);
    });
  });

  describe('pagination correctness', () => {
    test('page=2 entries do NOT overlap page=1', async () => {
      memory.seed(10);
      const res1 = await routes.entries(
        new Request('http://localhost/api/memory/entries?page=1&limit=4'),
      );
      const res2 = await routes.entries(
        new Request('http://localhost/api/memory/entries?page=2&limit=4'),
      );
      const b1 = await res1.json();
      const b2 = await res2.json();

      // biome-ignore lint/suspicious/noExplicitAny: test mock
      const ids1 = new Set(b1.data.entries.map((e: any) => e.id));
      for (const e of b2.data.entries) {
        expect(ids1.has(e.id)).toBe(false);
      }
    });

    test('totalCount is correct regardless of page', async () => {
      memory.seed(15);
      const res = await routes.entries(
        new Request('http://localhost/api/memory/entries?page=3&limit=4'),
      );
      const body = await res.json();
      expect(body.data.totalCount).toBe(15);
      expect(body.data.entries.length).toBeLessThanOrEqual(4);
    });

    test('page beyond data returns empty entries with correct totalCount', async () => {
      memory.seed(5);
      const res = await routes.entries(
        new Request('http://localhost/api/memory/entries?page=99&limit=5'),
      );
      const body = await res.json();
      expect(body.data.entries).toHaveLength(0);
      expect(body.data.totalCount).toBe(5);
    });

    test('empty store returns totalCount=0', async () => {
      const res = await routes.entries(new Request('http://localhost/api/memory/entries'));
      const body = await res.json();
      expect(body.data.entries).toHaveLength(0);
      expect(body.data.totalCount).toBe(0);
    });
  });

  describe('validation', () => {
    test('invalid page throws BadRequestError', async () => {
      const req = new Request('http://localhost/api/memory/entries?page=abc');
      await expect(routes.entries(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('negative limit throws BadRequestError', async () => {
      const req = new Request('http://localhost/api/memory/entries?limit=-1');
      await expect(routes.entries(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });
});
