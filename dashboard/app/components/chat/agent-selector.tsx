'use client';

import type { AgentRuntimeInfo } from '@autonomy/shared';
import { ChevronDown, Cpu } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface AgentSelectorProps {
  agents: AgentRuntimeInfo[];
  selected: string | undefined;
  onSelect: (agentId: string | undefined) => void;
  conductorName?: string;
}

const statusDot: Record<string, string> = {
  active: 'bg-neon-cyan',
  idle: 'bg-neon-amber',
  busy: 'bg-neon-purple',
  stopped: 'bg-muted-foreground',
  error: 'bg-neon-red',
};

const MAX_VISIBLE = 2;

export function AgentSelector({
  agents,
  selected,
  onSelect,
  conductorName = 'Conductor',
}: AgentSelectorProps) {
  const [showOverflow, setShowOverflow] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const visibleAgents = agents.slice(0, MAX_VISIBLE);
  const overflowAgents = agents.slice(MAX_VISIBLE);
  const selectedIsOverflow = overflowAgents.some((a) => a.id === selected);

  const closeDropdown = useCallback(() => {
    setShowOverflow(false);
    setFocusedIndex(-1);
    triggerRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!showOverflow) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showOverflow, closeDropdown]);

  // Focus first item when dropdown opens
  useEffect(() => {
    if (showOverflow) {
      setFocusedIndex(0);
      itemRefs.current[0]?.focus();
    }
  }, [showOverflow]);

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(focusedIndex + 1, overflowAgents.length - 1);
      setFocusedIndex(next);
      itemRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(focusedIndex - 1, 0);
      setFocusedIndex(prev);
      itemRefs.current[prev]?.focus();
    }
  }

  return (
    <div className="flex items-center gap-1 p-2">
      {/* Conductor — primary, always visible, visually prominent */}
      <button
        type="button"
        onClick={() => onSelect(undefined)}
        aria-label={`${conductorName}, auto-routes to the right agent`}
        className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all border ${
          selected === undefined
            ? 'bg-neon-purple/20 text-neon-purple border-neon-purple/20 glow-purple'
            : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
        }`}
      >
        <Cpu className="h-3 w-3" aria-hidden="true" />
        {conductorName}
      </button>

      {/* Separator */}
      {agents.length > 0 && <div className="h-4 w-px bg-border/50 mx-1" aria-hidden="true" />}

      {/* Visible agents — smaller, secondary treatment */}
      {visibleAgents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onSelect(agent.id)}
          aria-label={`${agent.name} (${agent.status})`}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
            selected === agent.id
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground/70 hover:text-muted-foreground'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusDot[agent.status] ?? 'bg-muted-foreground'}`}
            aria-hidden="true"
          />
          {agent.name}
        </button>
      ))}

      {/* Overflow dropdown — uses ARIA menu pattern */}
      {overflowAgents.length > 0 && (
        <div className="relative" ref={dropdownRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setShowOverflow((prev) => !prev)}
            aria-expanded={showOverflow}
            aria-haspopup="menu"
            aria-label={`${overflowAgents.length} more agents`}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
              selectedIsOverflow
                ? 'text-primary'
                : 'text-muted-foreground/50 hover:text-muted-foreground'
            }`}
          >
            {selectedIsOverflow
              ? (overflowAgents.find((a) => a.id === selected)?.name ?? 'Agent')
              : `+${overflowAgents.length}`}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showOverflow ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {showOverflow && (
            <div
              role="menu"
              aria-label="Additional agents"
              onKeyDown={handleMenuKeyDown}
              className="absolute top-full left-0 mt-1 z-50 glass rounded-md border border-border py-1 min-w-48"
            >
              {overflowAgents.map((agent, i) => (
                <button
                  key={agent.id}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelect(agent.id);
                    closeDropdown();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left ${
                    selected === agent.id
                      ? 'text-primary bg-primary/5'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot[agent.status] ?? 'bg-muted-foreground'}`}
                    aria-hidden="true"
                  />
                  {agent.name}
                  <span className="ml-auto text-[10px] text-muted-foreground/40 capitalize">
                    {agent.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
