'use client';

import type { PipelinePhase } from '@/hooks/use-websocket';
import { getPhaseConfig } from './pipeline-constants';

export function ProcessingProgressStrip({ phases }: { phases: PipelinePhase[] }) {
  const lastPhase = phases[phases.length - 1];
  const config = lastPhase ? getPhaseConfig(lastPhase.phase) : null;

  return (
    <div className="flex justify-center py-2" aria-live="polite">
      <div className="flex items-center gap-2">
        {/* Phase dots — each lights up as phases arrive */}
        <div className="flex items-center gap-1">
          {phases.map((p, i) => {
            const pc = getPhaseConfig(p.phase);
            const isLast = i === phases.length - 1;
            return (
              <span
                key={`${p.phase}-${i}`}
                className={`h-1.5 w-1.5 rounded-full ${pc.dot} ${isLast ? 'animate-pulse' : 'opacity-60'}`}
              />
            );
          })}
        </div>

        {/* Friendly label for current phase */}
        {config && (
          <span className={`text-xs font-mono ${config.text} opacity-70`}>
            {config.friendlyLabel}
          </span>
        )}
      </div>
    </div>
  );
}
