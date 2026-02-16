'use client';

import type { DebugEvent, DebugEventCategory, DebugEventLevel } from '@autonomy/shared';
import { ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';

const CATEGORY_STYLES: Record<DebugEventCategory, { label: string; color: string; bg: string }> = {
  conductor: {
    label: 'COND',
    color: 'text-neon-cyan',
    bg: 'bg-neon-cyan/10 border-neon-cyan/30',
  },
  agent: {
    label: 'AGNT',
    color: 'text-neon-purple',
    bg: 'bg-neon-purple/10 border-neon-purple/30',
  },
  memory: {
    label: 'MEM',
    color: 'text-neon-green',
    bg: 'bg-neon-green/10 border-neon-green/30',
  },
  websocket: {
    label: 'WS',
    color: 'text-neon-amber',
    bg: 'bg-neon-amber/10 border-neon-amber/30',
  },
  system: {
    label: 'SYS',
    color: 'text-neon-red',
    bg: 'bg-neon-red/10 border-neon-red/30',
  },
};

const LEVEL_STYLES: Record<DebugEventLevel, string> = {
  debug: 'text-muted-foreground/60',
  info: 'text-foreground',
  warn: 'text-neon-amber',
  error: 'text-neon-red',
};

const LEVEL_INDICATOR: Record<DebugEventLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

export const DebugEventRow = memo(function DebugEventRow({ event }: { event: DebugEvent }) {
  const [expanded, setExpanded] = useState(false);
  const cat = CATEGORY_STYLES[event.category];
  const levelStyle = LEVEL_STYLES[event.level];
  const levelLabel = LEVEL_INDICATOR[event.level];
  const hasData = event.data && Object.keys(event.data).length > 0;

  return (
    <div className="group border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
      <button
        type="button"
        className={`flex w-full items-center gap-2 px-3 py-1.5 font-mono text-xs select-none text-left bg-transparent border-none p-0 ${hasData ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={() => hasData && setExpanded(!expanded)}
        aria-expanded={hasData ? expanded : undefined}
        aria-label={`${levelLabel} ${cat.label} event: ${event.message}`}
      >
        {/* Expand indicator */}
        <span className="w-3 shrink-0">
          {hasData && (
            <ChevronRight
              className={`h-3 w-3 text-muted-foreground/40 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
        </span>

        {/* Timestamp */}
        <span className="text-muted-foreground/50 shrink-0 w-[85px]">
          {formatTimestamp(event.timestamp)}
        </span>

        {/* Level */}
        <span className={`shrink-0 w-[28px] font-bold ${levelStyle}`}>{levelLabel}</span>

        {/* Category badge */}
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${cat.bg} ${cat.color}`}
        >
          {cat.label}
        </span>

        {/* Source */}
        <span className="text-muted-foreground/70 shrink-0 max-w-[160px] truncate">
          {event.source}
        </span>

        {/* Message */}
        <span className={`truncate ${levelStyle}`}>{event.message}</span>

        {/* Duration */}
        {event.durationMs !== undefined && (
          <span className="ml-auto shrink-0 text-muted-foreground/50">{event.durationMs}ms</span>
        )}
      </button>

      {/* Expanded data payload */}
      {expanded && hasData && (
        <div className="mx-3 mb-2 ml-[120px] p-3 rounded glass font-mono text-[11px] text-muted-foreground overflow-x-auto">
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(event.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
});
