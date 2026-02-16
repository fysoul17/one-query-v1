'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { PipelinePhase } from '@/hooks/use-websocket';
import { getPhaseConfig } from './pipeline-constants';

function PipelinePhaseRow({
  phase,
  isActive,
  isLast,
}: {
  phase: PipelinePhase;
  isActive: boolean;
  isLast: boolean;
}) {
  const config = getPhaseConfig(phase.phase);
  const debug = phase.debug;

  return (
    <div className="flex items-start gap-2">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className={`h-2 w-2 rounded-full shrink-0 mt-1 ${config.dot} ${isActive ? 'animate-pulse' : ''}`}
        />
        {!isLast && <div className="w-px h-full min-h-3 bg-border/30" />}
      </div>

      {/* Phase content */}
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-[10px] font-mono font-medium ${config.text} shrink-0`}>
            {config.label}
          </span>
          {phase.durationMs !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
              {phase.durationMs}ms
            </span>
          )}
          {isActive && (
            <span className="text-[10px] font-mono text-neon-cyan/60 animate-pulse">
              running...
            </span>
          )}
        </div>

        {/* Detail data rows */}
        {debug && (
          <div className="mt-0.5 space-y-0.5">
            {debug.memoryQuery && (
              <div className="text-[9px] font-mono text-muted-foreground/50">
                query: &quot;{debug.memoryQuery}&quot;
              </div>
            )}
            {debug.memoryResults !== undefined && (
              <div className="text-[9px] font-mono text-muted-foreground/50">
                results: {debug.memoryResults} entries
              </div>
            )}
            {debug.memoryEntryPreviews && debug.memoryEntryPreviews.length > 0 && (
              <div className="text-[9px] font-mono text-muted-foreground/40">
                {debug.memoryEntryPreviews.map((preview, idx) => {
                  const key = `${preview.slice(0, 20)}-${idx}`;
                  return (
                    <div key={key} className="truncate pl-2">
                      {preview}...
                    </div>
                  );
                })}
              </div>
            )}
            {debug.routerType && (
              <div className="text-[9px] font-mono text-muted-foreground/50">
                type: {debug.routerType}
                {debug.targetAgentIds && debug.targetAgentIds.length > 0 && (
                  <> | targets: [{debug.targetAgentIds.join(', ')}]</>
                )}
              </div>
            )}
            {debug.routingReason && phase.phase !== 'analyzing' && (
              <div className="text-[9px] font-mono text-muted-foreground/50 truncate">
                {debug.routingReason}
              </div>
            )}
            {debug.dispatchTarget && (
              <div className="text-[9px] font-mono text-muted-foreground/50">
                target: {debug.dispatchTarget}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function LivePipelineCard({
  phases,
  isProcessing,
}: {
  phases: PipelinePhase[];
  isProcessing?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showDecisions, setShowDecisions] = useState(false);

  const totalDuration = phases.reduce((sum, p) => sum + (p.durationMs ?? 0), 0);
  const lastPhaseWithDecisions = [...phases].reverse().find((p) => p.debug?.decisions);

  return (
    <div className="flex justify-center py-1">
      <div className="w-full max-w-[600px]">
        {/* Header bar */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label="Toggle processing details"
          className="flex items-center gap-2 w-full glass rounded-t-md border-b-0 px-3 py-1.5 hover:border-neon-cyan/20 transition-colors group"
        >
          <span className="text-[10px] font-mono font-medium text-neon-cyan/70">PROCESSING</span>

          {/* Phase dots summary */}
          <div className="flex items-center gap-0.5 ml-1">
            {phases.map((p, i) => (
              <div
                key={`dot-${p.phase}-${i}`}
                className={`h-1 w-1 rounded-full ${getPhaseConfig(p.phase).dot} ${
                  isProcessing && i === phases.length - 1 ? 'animate-pulse' : ''
                }`}
              />
            ))}
          </div>

          <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">
            {isProcessing ? (
              <span className="text-neon-cyan/60 animate-pulse">live</span>
            ) : (
              <span>{totalDuration > 0 ? `${totalDuration}ms` : '...'}</span>
            )}
          </span>

          <ChevronDown
            className={`h-3 w-3 text-muted-foreground/40 transition-transform group-hover:text-muted-foreground ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Expanded timeline */}
        {expanded && (
          <div
            className="glass rounded-b-md px-3 py-2 border-t border-border/20"
            aria-live="polite"
          >
            <div className="space-y-0">
              {phases.map((phase, i) => (
                <PipelinePhaseRow
                  key={`${phase.phase}-${i}`}
                  phase={phase}
                  isActive={isProcessing === true && i === phases.length - 1}
                  isLast={i === phases.length - 1}
                />
              ))}
            </div>

            {/* Decisions toggle */}
            {lastPhaseWithDecisions && !isProcessing && (
              <div className="pt-1 border-t border-border/20 mt-1">
                <button
                  type="button"
                  onClick={() => setShowDecisions(!showDecisions)}
                  aria-expanded={showDecisions}
                  aria-label="Toggle raw decisions"
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${showDecisions ? 'rotate-180' : ''}`}
                  />
                  {showDecisions ? 'Hide' : 'Show'} decisions
                </button>
                {showDecisions && (
                  <pre className="mt-1 glass rounded p-2 text-[9px] font-mono text-muted-foreground/70 overflow-x-auto max-h-40">
                    {JSON.stringify(lastPhaseWithDecisions.debug?.decisions, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
