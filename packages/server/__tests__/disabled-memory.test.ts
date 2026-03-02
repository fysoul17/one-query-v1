import { describe, expect, test } from 'bun:test';
import type { MemoryInterface } from '@pyx-memory/client';
import { DisabledMemory } from '../src/disabled-memory.ts';

describe('DisabledMemory', () => {
  describe('interface compliance', () => {
    test('implements MemoryInterface', () => {
      const memory: MemoryInterface = new DisabledMemory();
      expect(memory).toBeDefined();
    });

    test('initialize() resolves without error', async () => {
      const memory = new DisabledMemory();
      await expect(memory.initialize()).resolves.toBeUndefined();
    });

    test('store() returns a MemoryEntry with given content and type', async () => {
      const memory = new DisabledMemory();
      const entry = await memory.store({
        content: 'test content',
        type: 'long-term',
        metadata: { key: 'value' },
      });

      expect(entry.id).toBe('disabled');
      expect(entry.content).toBe('test content');
      expect(entry.type).toBe('long-term');
      expect(entry.metadata).toEqual({});
      expect(entry.createdAt).toBeTruthy();
    });

    test('search() returns empty results', async () => {
      const memory = new DisabledMemory();
      const result = await memory.search({ query: 'anything', limit: 10 });

      expect(result.entries).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.strategy).toBe('naive');
    });

    test('list() returns empty results with default pagination', async () => {
      const memory = new DisabledMemory();
      const result = await memory.list();

      expect(result.entries).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    test('get() returns null', async () => {
      const memory = new DisabledMemory();
      const result = await memory.get('any-id');
      expect(result).toBeNull();
    });

    test('delete() returns false', async () => {
      const memory = new DisabledMemory();
      const result = await memory.delete('any-id');
      expect(result).toBe(false);
    });

    test('clearSession() returns 0', async () => {
      const memory = new DisabledMemory();
      const result = await memory.clearSession('session-123');
      expect(result).toBe(0);
    });

    test('stats() returns all-zero statistics with connected: false', async () => {
      const memory = new DisabledMemory();
      const stats = await memory.stats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.storageUsedBytes).toBe(0);
      expect(stats.vectorCount).toBe(0);
      expect(stats.recentAccessCount).toBe(0);
      expect(stats.connected).toBe(false);
    });

    test('shutdown() resolves without error', async () => {
      const memory = new DisabledMemory();
      await expect(memory.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('repeated calls are safe', () => {
    test('multiple initialize() calls do not throw', async () => {
      const memory = new DisabledMemory();
      await memory.initialize();
      await memory.initialize();
    });

    test('multiple store() calls return independent entries', async () => {
      const memory = new DisabledMemory();
      const e1 = await memory.store({ content: 'first', type: 'long-term', metadata: {} });
      const e2 = await memory.store({ content: 'second', type: 'short-term', metadata: {} });

      expect(e1.content).toBe('first');
      expect(e2.content).toBe('second');
      expect(e1.type).toBe('long-term');
      expect(e2.type).toBe('short-term');
    });

    test('shutdown() then initialize() works (restart scenario)', async () => {
      const memory = new DisabledMemory();
      await memory.initialize();
      await memory.shutdown();
      await memory.initialize();

      const stats = await memory.stats();
      expect(stats.totalEntries).toBe(0);
    });
  });
});
