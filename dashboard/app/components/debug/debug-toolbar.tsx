'use client';

import type { DebugEventCategory, DebugEventLevel } from '@autonomy/shared';
import { DebugEventCategory as Categories, DebugEventLevel as Levels } from '@autonomy/shared';
import { ExternalLink, Pause, Play, Trash2 } from 'lucide-react';

const CATEGORY_CONFIG: Array<{
  value: DebugEventCategory;
  label: string;
  activeClass: string;
}> = [
  {
    value: Categories.CONDUCTOR,
    label: 'Conductor',
    activeClass: 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan',
  },
  {
    value: Categories.AGENT,
    label: 'Agent',
    activeClass: 'bg-neon-purple/20 border-neon-purple/50 text-neon-purple',
  },
  {
    value: Categories.MEMORY,
    label: 'Memory',
    activeClass: 'bg-neon-green/20 border-neon-green/50 text-neon-green',
  },
  {
    value: Categories.WEBSOCKET,
    label: 'WebSocket',
    activeClass: 'bg-neon-amber/20 border-neon-amber/50 text-neon-amber',
  },
  {
    value: Categories.SYSTEM,
    label: 'System',
    activeClass: 'bg-neon-red/20 border-neon-red/50 text-neon-red',
  },
];

const LEVEL_OPTIONS: Array<{ value: DebugEventLevel; label: string }> = [
  { value: Levels.DEBUG, label: 'Debug+' },
  { value: Levels.INFO, label: 'Info+' },
  { value: Levels.WARN, label: 'Warn+' },
  { value: Levels.ERROR, label: 'Error' },
];

interface DebugToolbarProps {
  activeCategories: Set<DebugEventCategory>;
  onToggleCategory: (category: DebugEventCategory) => void;
  minLevel: DebugEventLevel;
  onSetMinLevel: (level: DebugEventLevel) => void;
  searchText: string;
  onSetSearchText: (text: string) => void;
  paused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  eventCount: number;
  filteredCount: number;
}

export function DebugToolbar({
  activeCategories,
  onToggleCategory,
  minLevel,
  onSetMinLevel,
  searchText,
  onSetSearchText,
  paused,
  onTogglePause,
  onClear,
  eventCount,
  filteredCount,
}: DebugToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 glass border-b border-white/[0.06]">
      {/* Category filter chips */}
      <div className="flex items-center gap-1">
        {CATEGORY_CONFIG.map((cat) => {
          const active = activeCategories.has(cat.value);
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => onToggleCategory(cat.value)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-all ${
                active
                  ? cat.activeClass
                  : 'bg-transparent border-white/10 text-muted-foreground/50 hover:border-white/20'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-white/10" />

      {/* Level selector */}
      <select
        value={minLevel}
        onChange={(e) => onSetMinLevel(e.target.value as DebugEventLevel)}
        aria-label="Minimum log level"
        className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[11px] text-muted-foreground focus:outline-none focus:border-primary/50"
      >
        {LEVEL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Search input */}
      <input
        type="text"
        value={searchText}
        onChange={(e) => onSetSearchText(e.target.value)}
        placeholder="Filter by source, message, agent..."
        aria-label="Filter events"
        className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 w-[200px]"
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Event count */}
      <span className="text-[11px] text-muted-foreground/60 font-mono">
        {filteredCount === eventCount ? `${eventCount} events` : `${filteredCount}/${eventCount}`}
      </span>

      {/* Divider */}
      <div className="h-4 w-px bg-white/10" />

      {/* Pause/Resume */}
      <button
        type="button"
        onClick={onTogglePause}
        className={`p-1 rounded hover:bg-white/10 transition-colors ${paused ? 'text-neon-amber' : 'text-muted-foreground'}`}
        title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
        aria-label={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      </button>

      {/* Clear */}
      <button
        type="button"
        onClick={onClear}
        className="p-1 rounded hover:bg-white/10 transition-colors text-muted-foreground"
        title="Clear events"
        aria-label="Clear events"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* Pop Out */}
      <button
        type="button"
        onClick={() => window.open('/activity', '_blank', 'width=1200,height=800')}
        className="p-1 rounded hover:bg-white/10 transition-colors text-muted-foreground"
        title="Open in new window"
        aria-label="Open in new window"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
