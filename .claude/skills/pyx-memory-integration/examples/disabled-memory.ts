import type { MemoryInterface, MemoryListResult } from '@pyx-memory/client';
import type { MemoryEntry, MemorySearchResult, MemoryStats } from '@pyx-memory/shared';

export class DisabledMemory implements MemoryInterface {
  async initialize(): Promise<void> {
    console.warn('Memory service not configured — running without memory');
  }
  async store(
    entry: Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<MemoryEntry> {
    return {
      id: '',
      content: entry.content,
      type: entry.type,
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }
  async search(): Promise<MemorySearchResult> {
    return { entries: [], totalCount: 0, strategy: 'naive' };
  }
  async list(): Promise<MemoryListResult> {
    return { entries: [], totalCount: 0, page: 1, limit: 20 };
  }
  async get(): Promise<MemoryEntry | null> {
    return null;
  }
  async delete(): Promise<boolean> {
    return false;
  }
  async clearSession(): Promise<number> {
    return 0;
  }
  async stats(): Promise<MemoryStats> {
    return {
      totalEntries: 0,
      storageUsedBytes: 0,
      vectorCount: 0,
      recentAccessCount: 0,
      connected: false,
    };
  }
  async shutdown(): Promise<void> {}
}

// Usage: pick the right implementation based on config
import { MemoryClient } from '@pyx-memory/client';

const memory: MemoryInterface = process.env.MEMORY_URL
  ? new MemoryClient(process.env.MEMORY_URL, process.env.MEMORY_API_KEY)
  : new DisabledMemory();

await memory.initialize();
