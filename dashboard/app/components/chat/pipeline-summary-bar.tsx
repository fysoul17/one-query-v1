'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { PipelinePhase } from '@/hooks/use-websocket';
import { getPhaseConfig } from './pipeline-constants';
import { PipelineTimeline } from './pipeline-timeline';

export function PipelineSummaryBar({ phases }: { phases: PipelinePhase[] }) {
  const [expanded, setExpanded] = useState(false);

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
        aria-label="Toggle processing details"
        className="flex items-center gap-2 glass rounded-md px-2 py-1 w-full hover:border-neon-cyan/20 transition-colors group"
      >
        {/* Phase dots */}
        <div className="flex items-center gap-1">
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
          className={`h-3 w-3 ml-auto text-muted-foreground/40 transition-transform group-hover:text-muted-foreground ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expanded timeline */}
      {expanded && (
        <div className="glass rounded-md mt-1 px-2 py-1">
          <PipelineTimeline phases={phases} />
        </div>
      )}
    </div>
  );
}
