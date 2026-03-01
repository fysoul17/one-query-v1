'use client';

import type { MemoryEntry } from '@autonomy/shared';
import type { PaginatedEntries } from '@pyx-memory/dashboard';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MemoryEntryCard } from './memory-entry-card';

interface MemoryEntryListProps {
  entries: MemoryEntry[];
  onSelectEntry: (entry: MemoryEntry) => void;
  pagination: PaginatedEntries | null;
  onPageChange: (page: number) => void;
  isLoading: boolean;
}

export function MemoryEntryList({
  entries,
  onSelectEntry,
  pagination,
  onPageChange,
  isLoading,
}: MemoryEntryListProps) {
  if (isLoading && entries.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Loading entries...</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No memory entries found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <MemoryEntryCard key={entry.id} entry={entry} onSelect={onSelectEntry} />
        ))}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={!pagination.hasPreviousPage || isLoading}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={!pagination.hasNextPage || isLoading}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
