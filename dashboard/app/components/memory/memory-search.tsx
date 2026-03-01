'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MemorySearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  strategy: string;
  onStrategyChange: (strategy: string) => void;
  typeFilter: string;
  onTypeFilterChange: (type: string) => void;
}

export function MemorySearch({
  query,
  onQueryChange,
  strategy,
  onStrategyChange,
  typeFilter,
  onTypeFilterChange,
}: MemorySearchProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search memory entries..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="pl-9 font-mono"
          aria-label="Search memory entries"
        />
      </div>
      <div className="flex gap-2">
        <Select value={strategy} onValueChange={onStrategyChange}>
          <SelectTrigger className="w-[120px]" aria-label="RAG strategy">
            <SelectValue placeholder="Strategy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="naive">Naive</SelectItem>
            <SelectItem value="hybrid">Hybrid</SelectItem>
            <SelectItem value="graph">Graph</SelectItem>
            <SelectItem value="agentic">Agentic</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={onTypeFilterChange}>
          <SelectTrigger className="w-[140px]" aria-label="Memory type filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="short-term">Short-term</SelectItem>
            <SelectItem value="long-term">Long-term</SelectItem>
            <SelectItem value="working">Working</SelectItem>
            <SelectItem value="episodic">Episodic</SelectItem>
            <SelectItem value="summary">Summary</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
