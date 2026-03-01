'use client';

import type { MemoryEntry, RAGStrategy } from '@autonomy/shared';
import type { EntryFilters } from '@pyx-memory/dashboard';
import { useKnowledgeGraph, useMemoryEntries, useMemoryStats } from '@pyx-memory/dashboard/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { searchMemoryWithStrategy } from '@/lib/api';
import { EntryDetailDialog } from './entry-detail-dialog';
import { GraphViewer } from './graph-viewer';
import { MemoryEntryList } from './memory-entry-list';
import { MemorySearch } from './memory-search';
import { MemoryStatsCards } from './memory-stats-cards';

interface MemoryBrowserProps {
  serverUrl: string;
}

export function MemoryBrowser({ serverUrl }: MemoryBrowserProps) {
  const [query, setQuery] = useState('');
  const [strategy, setStrategy] = useState<string>('naive');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selectedEntry, setSelectedEntry] = useState<MemoryEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchFetchIdRef = useRef(0);

  const stats = useMemoryStats(serverUrl);
  const graph = useKnowledgeGraph(serverUrl);
  const entries = useMemoryEntries(serverUrl, {
    page,
    limit: 20,
    type: typeFilter !== 'all' ? (typeFilter as EntryFilters['type']) : undefined,
  });

  function handleTypeFilterChange(newType: string) {
    setTypeFilter(newType);
    setPage(1);
  }

  function handleStrategyChange(newStrategy: string) {
    setStrategy(newStrategy);
    setPage(1);
  }

  const executeSearch = useCallback(
    async (fetchId: number) => {
      try {
        const results = await searchMemoryWithStrategy(query, {
          strategy: strategy as RAGStrategy,
          type: typeFilter !== 'all' ? typeFilter : undefined,
          limit: 20,
        });
        if (fetchId !== searchFetchIdRef.current) return;
        setSearchResults(results.entries);
      } catch (err) {
        if (fetchId !== searchFetchIdRef.current) return;
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (fetchId === searchFetchIdRef.current) setSearching(false);
      }
    },
    [query, strategy, typeFilter],
  );

  // Search with debounce and stale-fetch guard
  useEffect(() => {
    if (!query.trim()) {
      searchFetchIdRef.current++;
      setSearchResults(null);
      setSearching(false);
      setSearchError(null);
      return;
    }

    searchFetchIdRef.current++;
    const fetchId = searchFetchIdRef.current;
    setSearching(true);
    setSearchError(null);
    const timeout = setTimeout(() => void executeSearch(fetchId), 300);
    return () => clearTimeout(timeout);
  }, [query, executeSearch]);

  function handleSelectEntry(entry: MemoryEntry) {
    setSelectedEntry(entry);
    setDialogOpen(true);
  }

  const handleMutate = useCallback(() => {
    entries.refetch();
    stats.refetch();
    graph.refetch();
    setSelectedEntry(null);
  }, [entries, stats, graph]);

  const isSearchMode = query.trim().length > 0;
  const displayEntries = isSearchMode ? (searchResults ?? []) : (entries.data?.entries ?? []);
  const paginatedData = !isSearchMode ? entries.data : null;

  const entryCount = searching
    ? '...'
    : isSearchMode
      ? `(${displayEntries.length})`
      : entries.data
        ? `(${entries.data.totalCount})`
        : '';

  return (
    <div className="space-y-6">
      <MemoryStatsCards
        stats={stats.data}
        graphNodeCount={graph.data?.nodeCount ?? null}
        graphEdgeCount={graph.data?.edgeCount ?? null}
      />

      <MemorySearch
        query={query}
        onQueryChange={setQuery}
        strategy={strategy}
        onStrategyChange={handleStrategyChange}
        typeFilter={typeFilter}
        onTypeFilterChange={handleTypeFilterChange}
      />

      {searchError && (
        <div className="rounded-lg border border-neon-red/30 bg-neon-red/10 p-3 text-sm text-neon-red">
          Search failed: {searchError}
        </div>
      )}

      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">Entries {entryCount}</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="mt-4">
          <MemoryEntryList
            entries={displayEntries}
            onSelectEntry={handleSelectEntry}
            pagination={paginatedData}
            onPageChange={setPage}
            isLoading={!isSearchMode && entries.isLoading}
          />
        </TabsContent>

        <TabsContent value="graph" className="mt-4">
          <GraphViewer data={graph.data} isLoading={graph.isLoading} error={graph.error} />
        </TabsContent>
      </Tabs>

      <EntryDetailDialog
        entry={selectedEntry}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onMutate={handleMutate}
      />
    </div>
  );
}
