'use client';

import type { DebugEvent, DebugEventCategory, DebugEventLevel } from '@autonomy/shared';
import {
  DebugEventCategory as Categories,
  DEBUG_LEVEL_ORDER,
  DebugEventLevel as Levels,
} from '@autonomy/shared';
import { Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebugWebSocket } from '@/hooks/use-debug-websocket';
import { DebugEventRow } from './debug-event-row';
import { DebugToolbar } from './debug-toolbar';

const ALL_CATEGORIES = new Set<DebugEventCategory>([
  Categories.CONDUCTOR,
  Categories.AGENT,
  Categories.MEMORY,
  Categories.WEBSOCKET,
  Categories.SYSTEM,
]);

export function DebugConsole() {
  const { status, events, clearEvents } = useDebugWebSocket();
  const [activeCategories, setActiveCategories] = useState<Set<DebugEventCategory>>(
    new Set(ALL_CATEGORIES),
  );
  const [minLevel, setMinLevel] = useState<DebugEventLevel>(Levels.DEBUG);
  const [searchText, setSearchText] = useState('');
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const toggleCategory = useCallback((category: DebugEventCategory) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const filteredEvents = useMemo(() => {
    const minLevelOrder = DEBUG_LEVEL_ORDER[minLevel];
    const search = searchText.toLowerCase();

    return events.filter((e: DebugEvent) => {
      if (!activeCategories.has(e.category)) return false;
      if (DEBUG_LEVEL_ORDER[e.level] < minLevelOrder) return false;
      if (search) {
        const haystack = `${e.source} ${e.message} ${e.agentId ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [events, activeCategories, minLevel, searchText]);

  // Auto-scroll logic
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const threshold = 50;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      isAtBottomRef.current = distanceFromBottom < threshold;
      if (isAtBottomRef.current && paused) {
        setPaused(false);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [paused]);

  // Scroll to bottom on new events (unless paused)
  // biome-ignore lint/correctness/useExhaustiveDependencies: filteredEvents.length triggers scroll on new events intentionally
  useEffect(() => {
    if (!paused && isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEvents.length, paused]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => {
      if (p) {
        // Resuming — scroll to bottom
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        });
        isAtBottomRef.current = true;
      }
      return !p;
    });
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] bg-[#0a0a0f]">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        {status === 'connected' ? (
          <>
            <Wifi className="h-3 w-3 text-neon-green" />
            <span className="text-[11px] text-neon-green font-mono">CONNECTED</span>
          </>
        ) : status === 'connecting' ? (
          <>
            <Wifi className="h-3 w-3 text-neon-amber animate-pulse" />
            <span className="text-[11px] text-neon-amber font-mono">CONNECTING...</span>
          </>
        ) : (
          <>
            <WifiOff className="h-3 w-3 text-neon-red" />
            <span className="text-[11px] text-neon-red font-mono">DISCONNECTED</span>
          </>
        )}
        <span className="text-[10px] text-muted-foreground/40 font-mono ml-auto">/ws/debug</span>
      </div>

      {/* Toolbar */}
      <DebugToolbar
        activeCategories={activeCategories}
        onToggleCategory={toggleCategory}
        minLevel={minLevel}
        onSetMinLevel={setMinLevel}
        searchText={searchText}
        onSetSearchText={setSearchText}
        paused={paused}
        onTogglePause={handleTogglePause}
        onClear={clearEvents}
        eventCount={events.length}
        filteredCount={filteredEvents.length}
      />

      {/* Event log */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/30 font-mono text-sm">
            {events.length === 0
              ? status === 'connected'
                ? 'Waiting for events...'
                : 'Connecting to debug stream...'
              : 'No events match filters'}
          </div>
        ) : (
          filteredEvents.map((event) => <DebugEventRow key={event.id} event={event} />)
        )}
      </div>

      {/* Paused indicator */}
      {paused && (
        <div className="px-3 py-1 border-t border-neon-amber/30 bg-neon-amber/5 text-center">
          <span className="text-[11px] text-neon-amber font-mono">
            PAUSED — Scroll to bottom or click Resume
          </span>
        </div>
      )}
    </div>
  );
}
