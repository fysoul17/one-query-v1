'use client';

import type { TimeWarning } from '@/hooks/use-processing-timer';

const DOT_COLOR: Record<TimeWarning, string> = {
  timeout_risk: 'bg-neon-red',
  very_long: 'bg-neon-amber',
  long: 'bg-neon-cyan',
  none: 'bg-neon-cyan',
};

const WARNING_TEXT: Partial<Record<TimeWarning, string>> = {
  timeout_risk: 'May time out soon',
  very_long: 'Taking longer than usual',
  long: 'Still working...',
};

export function ProcessingIndicator({
  phaseText,
  elapsedMs,
  warning = 'none',
}: {
  phaseText?: string;
  elapsedMs?: number;
  warning?: TimeWarning;
}) {
  const dotColor = DOT_COLOR[warning];
  const warningText = WARNING_TEXT[warning];

  const elapsedStr =
    elapsedMs !== undefined && elapsedMs >= 10_000 ? `${Math.floor(elapsedMs / 1000)}s` : undefined;

  return (
    <div className="flex justify-center py-2" aria-live="polite">
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <div className="flex items-center gap-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${dotColor} animate-bounce motion-reduce:animate-none [animation-delay:0ms]`}
          />
          <span
            className={`h-1.5 w-1.5 rounded-full ${dotColor} animate-bounce motion-reduce:animate-none [animation-delay:150ms]`}
          />
          <span
            className={`h-1.5 w-1.5 rounded-full ${dotColor} animate-bounce motion-reduce:animate-none [animation-delay:300ms]`}
          />
        </div>
        <span className="text-xs text-muted-foreground/60 font-mono">
          {phaseText ?? 'Thinking...'}
        </span>
        {elapsedStr && (
          <span
            role="timer"
            aria-live="off"
            className={`text-[10px] font-mono ${warning !== 'none' ? 'text-neon-amber' : 'text-muted-foreground/40'}`}
          >
            {elapsedStr}
          </span>
        )}
        {warningText && (
          <span
            className={`text-[10px] font-mono ${warning === 'timeout_risk' ? 'text-neon-red' : 'text-neon-amber'}`}
          >
            {warningText}
          </span>
        )}
      </div>
    </div>
  );
}
