'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import type { PipelinePhase } from '@/hooks/use-websocket';
import { getPhaseConfig } from './pipeline-constants';
import { PipelineTimeline } from './pipeline-timeline';

export function PipelineSummaryBar({ phases }: { phases: PipelinePhase[] }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  // Calculate total duration from phases that have it
  const totalDuration = phases.reduce((sum, p) => sum + (p.durationMs ?? 0), 0);

  // Deduplicate phases for the dot display (e.g. two ROUTING events -> one dot)
  const uniquePhases = [...new Set(phases.map((p) => p.phase))];

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label="Toggle processing details"
        className="flex items-center gap-2 rounded-md px-2 py-1 w-full hover:border-primary/20 transition-colors group"
      >
        {/* Phase dots — decorative */}
        <div className="flex items-center gap-1" aria-hidden="true">
          {uniquePhases.map((phase) => (
            <div key={phase} className={`h-1.5 w-1.5 rounded-full ${getPhaseConfig(phase).dot}`} />
          ))}
        </div>

        {/* Duration label */}
        <span className="text-[10px] font-mono text-muted-foreground/60">
          {totalDuration > 0 ? `${totalDuration}ms` : '...'}
        </span>

        <span className="text-[10px] text-muted-foreground/40">
          {phases.length} step{phases.length !== 1 ? 's' : ''}
        </span>

        {/* Expand chevron */}
        <ChevronDown
          className={`h-3 w-3 ml-auto text-muted-foreground/40 transition-transform motion-reduce:transition-none group-hover:text-muted-foreground ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Expanded timeline */}
      {expanded && (
        <section id={panelId} aria-label="Processing steps" className="rounded-md mt-1 px-2 py-1">
          <PipelineTimeline phases={phases} />
        </section>
      )}
    </div>
  );
}
