import type {
  MemoryEntry,
  MemoryInterface,
  MemoryListResult,
  MemorySearchResult,
  MemoryStats,
} from '@autonomy/shared';
import { Logger, RAGStrategy } from '@autonomy/shared';

const log = new Logger({ context: { source: 'disabled-memory' } });
const DEFAULT_PAGE_LIMIT = 20;

/**
 * No-op memory implementation for when MEMORY_URL is not configured.
 * All methods return safe defaults so the rest of the system functions without memory.
 */
export class DisabledMemory implements MemoryInterface {
  async initialize(): Promise<void> {
    log.warn('Memory service not configured — running without memory');
  }

  async store(entry: { content: string; type: string }): Promise<MemoryEntry> {
    return {
      id: 'disabled',
      content: entry.content,
      type: entry.type as MemoryEntry['type'],
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }

  async search(): Promise<MemorySearchResult> {
    return { entries: [], totalCount: 0, strategy: RAGStrategy.NAIVE };
  }

  async list(): Promise<MemoryListResult> {
    return { entries: [], totalCount: 0, page: 1, limit: DEFAULT_PAGE_LIMIT };
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

  async queryAsOf(): Promise<MemoryEntry[]> {
    return [];
  }

  async queryByEventTime(): Promise<MemoryEntry[]> {
    return [];
  }

  async shutdown(): Promise<void> {}
}
