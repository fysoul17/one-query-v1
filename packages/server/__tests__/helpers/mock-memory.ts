import type {
  ConsolidationRunResult,
  ExtendedMemoryInterface,
  MemoryEntry,
  MemoryInterface,
  MemoryListParams,
  MemoryListResult,
  MemorySearchParams,
  MemorySearchResult,
  MemoryStats,
  StoreInput,
} from '@autonomy/shared';
import { RAGStrategy } from '@autonomy/shared';

export class MockMemory implements MemoryInterface {
  clearSessionCalls: string[] = [];
  storeCalls: StoreInput[] = [];
  initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async store(
    entry: Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<MemoryEntry> {
    this.storeCalls.push({ ...entry } as StoreInput);
    return {
      id: entry.id ?? crypto.randomUUID(),
      content: entry.content,
      type: entry.type,
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      metadata: entry.metadata ?? {},
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };
  }

  async search(_params: MemorySearchParams): Promise<MemorySearchResult> {
    return { entries: [], totalCount: 0, strategy: RAGStrategy.NAIVE };
  }

  async list(params?: MemoryListParams): Promise<MemoryListResult> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    return { entries: [], totalCount: 0, page, limit };
  }

  async get(_id: string): Promise<MemoryEntry | null> {
    return null;
  }

  async delete(_id: string): Promise<boolean> {
    return false;
  }

  async clearSession(sessionId: string): Promise<number> {
    this.clearSessionCalls.push(sessionId);
    return 0;
  }

  async stats(): Promise<MemoryStats> {
    return { totalEntries: 0, storageUsedBytes: 0, vectorCount: 0, recentAccessCount: 0 };
  }

  async queryAsOf(): Promise<MemoryEntry[]> {
    return [];
  }

  async queryByEventTime(): Promise<MemoryEntry[]> {
    return [];
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}

/**
 * Extended mock that also implements lifecycle methods (consolidate, forget, etc.).
 * Use this for lifecycle route tests and session delete summarization tests.
 */
export class MockExtendedMemory extends MockMemory implements ExtendedMemoryInterface {
  consolidateCalls = 0;
  forgetCalls: Array<{ id: string; reason?: string }> = [];
  summarizeSessionCalls: string[] = [];
  decayCalls = 0;
  reindexCalls = 0;
  deleteBySourceCalls: string[] = [];

  async consolidate(): Promise<ConsolidationRunResult> {
    this.consolidateCalls++;
    return { entriesProcessed: 10, entriesMerged: 2, entriesArchived: 1, durationMs: 100 };
  }

  async forget(id: string, reason?: string): Promise<boolean> {
    this.forgetCalls.push({ id, reason });
    return true;
  }

  async summarizeSession(sessionId: string): Promise<MemoryEntry | null> {
    this.summarizeSessionCalls.push(sessionId);
    return {
      id: 'summary-1',
      content: `Summary of session ${sessionId}`,
      type: 'summary' as MemoryEntry['type'],
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }

  async runDecay(): Promise<number> {
    this.decayCalls++;
    return 3;
  }

  async reindex(): Promise<void> {
    this.reindexCalls++;
  }

  async deleteBySource(source: string): Promise<number> {
    this.deleteBySourceCalls.push(source);
    return 5;
  }
}
