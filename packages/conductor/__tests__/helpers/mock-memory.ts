import type {
  MemoryEntry,
  MemorySearchParams,
  MemorySearchResult,
  MemoryStats,
  MemoryType,
} from '@autonomy/shared';
import { RAGStrategy } from '@autonomy/shared';

export class MockMemory {
  private entries = new Map<string, MemoryEntry>();
  private _searchResults: MemorySearchResult = {
    entries: [],
    totalCount: 0,
    strategy: RAGStrategy.NAIVE,
  };
  private _shouldThrow = false;
  initialized = false;
  storeCalls: Array<{ content: string; type: MemoryType }> = [];
  searchCalls: MemorySearchParams[] = [];

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  setSearchResults(results: MemorySearchResult): void {
    this._searchResults = results;
  }

  setShouldThrow(shouldThrow: boolean): void {
    this._shouldThrow = shouldThrow;
  }

  async store(
    entry: Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<MemoryEntry> {
    if (this._shouldThrow) throw new Error('Mock memory store error');
    const full: MemoryEntry = {
      id: entry.id ?? `mem-${this.entries.size + 1}`,
      content: entry.content,
      type: entry.type,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      metadata: entry.metadata ?? {},
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };
    this.entries.set(full.id, full);
    this.storeCalls.push({ content: full.content, type: full.type });
    return full;
  }

  async search(params: MemorySearchParams): Promise<MemorySearchResult> {
    if (this._shouldThrow) throw new Error('Mock memory search error');
    this.searchCalls.push(params);
    return this._searchResults;
  }

  get(id: string): MemoryEntry | null {
    return this.entries.get(id) ?? null;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  clearSession(_sessionId: string): number {
    return 0;
  }

  async stats(): Promise<MemoryStats> {
    return {
      totalEntries: this.entries.size,
      storageUsedBytes: 0,
      vectorCount: 0,
      recentAccessCount: 0,
    };
  }

  async shutdown(): Promise<void> {
    this.entries.clear();
    this.initialized = false;
  }
}
