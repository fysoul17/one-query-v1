'use client';

import { ChevronDown, Wrench } from 'lucide-react';
import { memo, useEffect, useId, useRef, useState } from 'react';
import type {
  ActivityFeed,
  AgentActivity,
  AgentThinking,
  AgentToolCall,
  PipelinePhase,
} from '@/hooks/use-websocket';
import { getPhaseConfig } from './pipeline-constants';

// ─── Duration formatter ────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Conductor phase row ───────────────────────────────────────────────────

const PhaseRow = memo(function PhaseRow({
  phase,
  isLast,
  isActive,
}: {
  phase: PipelinePhase;
  isLast: boolean;
  isActive: boolean;
}) {
  const config = getPhaseConfig(phase.phase);
  const debug = phase.debug;
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center">
        <div
          className={`h-2 w-2 rounded-full shrink-0 mt-1 ${config.dot} ${isActive ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        />
        {!isLast && <div className="w-px flex-1 min-h-3 bg-border/30 mt-0.5" />}
      </div>
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-[10px] font-mono font-medium ${config.text} shrink-0`}>
            {config.label || phase.phase}
          </span>
          {phase.durationMs !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
              {formatDuration(phase.durationMs)}
            </span>
          )}
        </div>
        {debug && (
          <div className="mt-0.5 space-y-0.5">
            {debug.memoryQuery && (
              <div className="text-[9px] font-mono text-muted-foreground/50 truncate">
                {/* A11y-3: /70 opacity clears 4.5:1 contrast on dark bg */}
                <span className="text-status-purple/70">query:</span> &quot;{debug.memoryQuery}
                &quot;
              </div>
            )}
            {debug.memoryResults !== undefined && (
              <div className="text-[9px] font-mono text-muted-foreground/50">
                <span className="text-status-purple/70">results:</span> {debug.memoryResults}{' '}
                entries
              </div>
            )}
            {debug.memoryEntryPreviews && debug.memoryEntryPreviews.length > 0 && (
              <div className="text-[9px] font-mono text-muted-foreground/40 pl-2">
                {/* UX-MEDIUM-4: cap at 3 previews to prevent layout blowout */}
                {debug.memoryEntryPreviews.slice(0, 3).map((preview, idx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static preview list
                  <div key={idx} className="truncate">
                    {preview}
                  </div>
                ))}
                {debug.memoryEntryPreviews.length > 3 && (
                  <div className="text-muted-foreground/30">
                    +{debug.memoryEntryPreviews.length - 3} more
                  </div>
                )}
              </div>
            )}
            {debug.historyTurnCount !== undefined && (
              <div className="text-[9px] font-mono text-muted-foreground/40">
                history: {debug.historyTurnCount} turns
                {debug.historyChars !== undefined && (
                  <span> · {(debug.historyChars / 1024).toFixed(1)}KB</span>
                )}
              </div>
            )}
            {debug.routerType && (
              <div className="text-[9px] font-mono text-muted-foreground/50">
                <span className="text-status-purple/70">route:</span> {debug.routerType}
                {debug.targetAgentIds && debug.targetAgentIds.length > 0 && (
                  <span className="text-muted-foreground/40">
                    {' '}
                    → [{debug.targetAgentIds.join(', ')}]
                  </span>
                )}
              </div>
            )}
            {debug.routingReason && phase.phase !== 'analyzing' && (
              <div className="text-[9px] font-mono text-muted-foreground/50 truncate italic">
                {debug.routingReason}
              </div>
            )}
            {debug.dispatchTarget && (
              <div className="text-[9px] font-mono text-muted-foreground/50">
                <span className="text-status-amber/70">target:</span> {debug.dispatchTarget}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Tool call row ─────────────────────────────────────────────────────────

const ToolCallRow = memo(function ToolCallRow({
  tool,
  isLast,
}: {
  tool: AgentToolCall;
  isLast: boolean;
}) {
  const isStreaming = tool.status === 'streaming';
  const hasInput = tool.accumulatedInput.length > 0;

  return (
    <div className="flex items-start gap-2 pl-8">
      <div className="flex flex-col items-center">
        <div
          className={`h-1.5 w-1.5 rounded-full shrink-0 mt-1.5 ${
            isStreaming
              ? 'bg-status-amber animate-pulse motion-reduce:animate-none'
              : 'bg-status-green'
          }`}
        />
        {!isLast && <div className="w-px flex-1 min-h-2 bg-border/20 mt-0.5" />}
      </div>
      <div className="flex-1 min-w-0 pb-1.5">
        <div className="flex items-baseline gap-2">
          <Wrench
            className="h-2.5 w-2.5 text-muted-foreground shrink-0 self-center"
            aria-hidden="true"
          />
          <span className="text-[10px] font-mono font-medium text-foreground/70 shrink-0">
            {tool.toolName}
          </span>
          {tool.durationMs !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
              {formatDuration(tool.durationMs)}
            </span>
          )}
          {isStreaming && (
            <span className="text-[10px] font-mono text-muted-foreground/50 animate-pulse motion-reduce:animate-none">
              running...
            </span>
          )}
        </div>
        {hasInput && (
          <div className="mt-0.5 rounded px-1.5 py-1 max-h-16 overflow-hidden">
            <pre className="text-[9px] font-mono text-muted-foreground/60 whitespace-pre-wrap break-all leading-tight">
              {tool.accumulatedInput}
              {isStreaming && (
                <span
                  className="inline-block h-3 w-0.5 bg-foreground/40 animate-pulse motion-reduce:animate-none ml-px align-middle"
                  aria-hidden="true"
                />
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Thinking row ──────────────────────────────────────────────────────────

const ThinkingRow = memo(function ThinkingRow({
  thinking,
  isStreaming,
}: {
  thinking: AgentThinking;
  isStreaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const thinkingPanelId = useId();

  return (
    <div className="flex items-start gap-2 pl-8">
      <div className="flex flex-col items-center">
        <div
          className={`h-1.5 w-1.5 rounded-full shrink-0 mt-1.5 bg-status-purple/60 ${
            isStreaming ? 'animate-pulse motion-reduce:animate-none' : ''
          }`}
        />
      </div>
      <div className="flex-1 min-w-0 pb-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-mono text-status-purple/50 hover:text-status-purple/70 transition-colors"
          aria-label={expanded ? 'Hide thinking content' : 'Show thinking content'}
          aria-expanded={expanded}
          aria-controls={thinkingPanelId}
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          thinking
        </button>
        {expanded && (
          <div id={thinkingPanelId} className="mt-0.5 rounded px-1.5 py-1 max-h-32 overflow-y-auto">
            <p className="text-[9px] font-mono text-muted-foreground/50 whitespace-pre-wrap leading-tight">
              {thinking.content}
              {isStreaming && (
                <span
                  className="inline-block h-3 w-0.5 bg-status-purple/50 animate-pulse motion-reduce:animate-none ml-px align-middle"
                  aria-hidden="true"
                />
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Agent section ─────────────────────────────────────────────────────────

const AgentSection = memo(function AgentSection({
  activity,
  isActive,
}: {
  activity: AgentActivity;
  isActive: boolean;
}) {
  const totalItems = activity.toolCalls.length + activity.thinkingBlocks.length;

  // Interleave tool calls and thinking blocks in timestamp order
  type Item =
    | { kind: 'tool'; data: AgentToolCall; startedAt: number }
    | { kind: 'thinking'; data: AgentThinking; startedAt: number };

  const items: Item[] = [
    ...activity.toolCalls.map((tc) => ({
      kind: 'tool' as const,
      data: tc,
      startedAt: tc.startedAt,
    })),
    ...activity.thinkingBlocks.map((tb) => ({
      kind: 'thinking' as const,
      data: tb,
      startedAt: tb.timestamp,
    })),
  ].sort((a, b) => a.startedAt - b.startedAt);

  return (
    <div>
      {/* Agent header */}
      <div className="flex items-center gap-2 pl-4 py-1.5">
        <div className="h-2 w-2 rounded-full bg-status-purple shrink-0" />
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] font-mono text-status-purple/60" aria-hidden="true">
            →
          </span>
          <span className="text-[10px] font-mono font-medium text-status-purple">
            {activity.agentName ?? activity.agentId}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/40">agent</span>
        </div>
      </div>
      {/* Steps */}
      {items.map((item, i) => {
        const isLast = i === totalItems - 1;
        if (item.kind === 'tool') {
          return <ToolCallRow key={item.data.toolId} tool={item.data} isLast={isLast} />;
        }
        return (
          <ThinkingRow
            key={`${item.data.timestamp}-${i}`}
            thinking={item.data}
            isStreaming={isActive && i === totalItems - 1}
          />
        );
      })}
    </div>
  );
});

// ─── Collapsed pill ────────────────────────────────────────────────────────

const CollapsedPill = memo(function CollapsedPill({
  feed,
  expanded,
  panelId,
  onToggle,
}: {
  feed: ActivityFeed;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const dotCount = Math.min(feed.totalSteps, 5);
  const agentCount = feed.agents.length;
  const label =
    agentCount > 1
      ? `${agentCount} agents · ${feed.totalSteps} steps · ${formatDuration(feed.totalDurationMs)}`
      : `${feed.totalSteps} step${feed.totalSteps !== 1 ? 's' : ''} · ${formatDuration(feed.totalDurationMs)}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 rounded-md px-2 py-1 w-full hover:border-primary/20 transition-colors group"
      aria-expanded={expanded}
      aria-controls={panelId}
      aria-label={`Agent activity: ${label}. Click to ${expanded ? 'collapse' : 'expand'}.`}
    >
      <span className="text-[10px] font-mono text-muted-foreground/50" aria-hidden="true">
        {expanded ? '▾' : '▸'}
      </span>
      {dotCount > 0 && (
        <div className="flex items-center gap-0.5" aria-hidden="true">
          {Array.from({ length: dotCount }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative dots, order is stable
            <div key={i} className="h-1 w-1 rounded-full bg-muted-foreground/60" />
          ))}
        </div>
      )}
      <span className="text-[10px] font-mono text-muted-foreground/50">{label}</span>
      <ChevronDown
        className={`h-3 w-3 ml-auto text-muted-foreground/40 transition-transform duration-200 ease-out motion-reduce:transition-none group-hover:text-muted-foreground ${
          expanded ? 'rotate-180' : ''
        }`}
        aria-hidden="true"
      />
    </button>
  );
});

// ─── Full feed content ─────────────────────────────────────────────────────

const FeedContent = memo(function FeedContent({
  phases,
  feed,
}: {
  phases: PipelinePhase[];
  feed: ActivityFeed;
}) {
  const totalPhases = phases.length;
  const hasAgents = feed.agents.length > 0;

  return (
    <div className="rounded-md px-3 py-2">
      {phases.map((phase, i) => (
        <PhaseRow
          key={`${phase.phase}-${phase.timestamp}`}
          phase={phase}
          isLast={i === totalPhases - 1 && !hasAgents}
          isActive={feed.isActive && i === totalPhases - 1 && !hasAgents}
        />
      ))}
      {feed.agents.map((activity) => (
        <AgentSection key={activity.agentId} activity={activity} isActive={feed.isActive} />
      ))}
    </div>
  );
});

// ─── SR-only announcer (debounced, polite) ─────────────────────────────────

function useDebouncedAnnouncement(feed: ActivityFeed, isActive: boolean) {
  const [announcement, setAnnouncement] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStepsRef = useRef(0);
  const prevIsActiveRef = useRef(isActive);

  // Debounced step-count announcements during active streaming — safe to run in effect
  useEffect(() => {
    if (feed.totalSteps !== prevStepsRef.current) {
      prevStepsRef.current = feed.totalSteps;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const completed = feed.agents
          .flatMap((a) => a.toolCalls)
          .filter((tc) => tc.status === 'complete').length;
        if (completed > 0) {
          setAnnouncement(`${completed} tool call${completed !== 1 ? 's' : ''} completed`);
        }
      }, 500);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [feed.totalSteps, feed.agents]);

  // One-shot completion announcement on active→inactive transition
  useEffect(() => {
    if (prevIsActiveRef.current && !isActive && feed.totalSteps > 0) {
      setAnnouncement(
        `Agent activity complete. ${feed.totalSteps} steps in ${formatDuration(feed.totalDurationMs)}.`,
      );
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, feed.totalSteps, feed.totalDurationMs]);

  return announcement;
}

// ─── Main LiveActivityFeed component ──────────────────────────────────────

export interface LiveActivityFeedProps {
  phases: PipelinePhase[];
  feed: ActivityFeed;
  /** When true, the feed is in its initial live/expanding state (not yet collapsed). */
  isLive: boolean;
}

export const LiveActivityFeed = memo(function LiveActivityFeed({
  phases,
  feed,
  isLive,
}: LiveActivityFeedProps) {
  const [userExpanded, setUserExpanded] = useState(false);
  const panelId = useId();
  const announcement = useDebouncedAnnouncement(feed, feed.isActive);

  // If no phases and no steps, nothing to show
  if (phases.length === 0 && feed.totalSteps === 0 && !feed.isActive) {
    return null;
  }

  const showCollapsed = !isLive && !feed.isActive && feed.totalSteps > 0;
  const showExpanded = userExpanded && showCollapsed;

  return (
    <div className="flex justify-center py-1">
      <div className="w-full max-w-[600px]">
        {/* SR-only announcer — debounced, does NOT fire on every delta */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>

        {/* LIVE state: full feed visible — no aria-live here to prevent SR floods;
            the sr-only debounced announcer handles screen reader updates */}
        {(isLive || feed.isActive) && (
          <div role="log" aria-label="Agent activity">
            <FeedContent phases={phases} feed={feed} />
          </div>
        )}

        {/* COLLAPSED state: pill + optional re-expanded content */}
        {showCollapsed && (
          <div>
            <CollapsedPill
              feed={feed}
              expanded={showExpanded}
              panelId={panelId}
              onToggle={() => setUserExpanded((v) => !v)}
            />
            <section
              id={panelId}
              aria-label="Agent activity details"
              className={`transition-all motion-reduce:transition-none ${
                showExpanded
                  ? 'max-h-[500px] overflow-y-auto opacity-100 duration-200 ease-out mt-1'
                  : 'max-h-0 overflow-hidden opacity-0 duration-150 ease-in'
              }`}
            >
              <FeedContent phases={phases} feed={feed} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
});
