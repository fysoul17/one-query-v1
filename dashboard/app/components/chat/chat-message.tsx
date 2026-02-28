import { Bot, Cpu, User } from 'lucide-react';
import { memo } from 'react';
import type { TimeWarning } from '@/hooks/use-processing-timer';
import type { ChatMessage } from '@/hooks/use-websocket';
import { LiveActivityFeed } from './live-activity-feed';
import { MarkdownRenderer } from './markdown-renderer';
import { getPhaseConfig } from './pipeline-constants';
import { PipelineSummaryBar } from './pipeline-summary-bar';
import { ProcessingIndicator } from './processing-indicator';
import { ProcessingProgressStrip } from './processing-progress-strip';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  showSteps?: boolean;
  elapsedMs?: number;
  warning?: TimeWarning;
}

function AvatarIcon({ isUser, isConductor }: { isUser: boolean; isConductor: boolean }) {
  if (isUser) return <User className="h-4 w-4 text-primary" aria-hidden="true" />;
  if (isConductor) return <Cpu className="h-4 w-4 text-neon-cyan" aria-hidden="true" />;
  return <Bot className="h-4 w-4 text-neon-purple" aria-hidden="true" />;
}

function getMessageStyles(isUser: boolean, isConductor: boolean) {
  if (isUser) {
    return {
      avatarBg: 'bg-primary/10',
      labelClass: '',
      bubbleBorder: 'glass border-primary/20 text-foreground',
    };
  }
  if (isConductor) {
    return {
      avatarBg: 'bg-neon-cyan/10',
      labelClass: 'text-neon-cyan text-glow-cyan',
      bubbleBorder: 'glass border-neon-cyan/20 text-foreground',
    };
  }
  return {
    avatarBg: 'bg-neon-purple/10',
    labelClass: 'text-neon-purple text-glow-purple',
    bubbleBorder: 'glass border-neon-purple/20 text-foreground',
  };
}

function SystemMessage({ message, showSteps, elapsedMs, warning }: ChatMessageBubbleProps) {
  const hasActivity = message.activityFeed && message.activityFeed.totalSteps > 0;
  const hasPipeline = message.pipeline && message.pipeline.length > 0;

  // While processing: show live activity feed if agent steps exist, otherwise fallback
  if (message.isProcessing) {
    if (showSteps && hasActivity) {
      return (
        <LiveActivityFeed
          phases={message.pipeline ?? []}
          // biome-ignore lint/style/noNonNullAssertion: activityFeed is guaranteed by hasActivity guard
          feed={message.activityFeed!}
          isLive={true}
        />
      );
    }
    // Pipeline phases exist but no agent steps yet — show the simpler progress strip
    if (showSteps && hasPipeline) {
      return <ProcessingProgressStrip phases={message.pipeline ?? []} />;
    }
    const lastPhase = message.pipeline?.[message.pipeline.length - 1];
    const phaseText = lastPhase ? getPhaseConfig(lastPhase.phase).friendlyLabel : undefined;
    return <ProcessingIndicator phaseText={phaseText} elapsedMs={elapsedMs} warning={warning} />;
  }

  // Completed system message with pipeline or activity: nothing to show
  // (the pipeline/activity data is transferred to the assistant message on complete)
  if (hasPipeline || hasActivity) {
    return null;
  }

  // Simple system status message (e.g. "Delegating to agent...")
  return (
    <div className="flex justify-center py-1">
      {/* biome-ignore lint/a11y/useSemanticElements: status messages are not form outputs */}
      <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground/70">
        <Cpu className="h-3 w-3 text-neon-cyan/50" />
        <span className="italic font-mono">{message.content}</span>
      </div>
    </div>
  );
}

export const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  showSteps,
  elapsedMs,
  warning,
}: ChatMessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <SystemMessage
        message={message}
        showSteps={showSteps}
        elapsedMs={elapsedMs}
        warning={warning}
      />
    );
  }

  const isUser = message.role === 'user';
  const isConductor = !isUser && message.agentId === 'conductor';
  const { avatarBg, labelClass, bubbleBorder } = getMessageStyles(isUser, isConductor);
  const label = isConductor ? 'conductor' : (message.agentName ?? message.agentId);

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${avatarBg}`}>
        <AvatarIcon isUser={isUser} isConductor={isConductor} />
      </div>
      <div className={`max-w-[80%] space-y-1 ${isUser ? 'items-end' : ''}`}>
        {!isUser && label && <span className={`text-[10px] font-mono ${labelClass}`}>{label}</span>}
        <div className={`rounded-lg px-3 py-2 text-sm ${bubbleBorder}`}>
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <MarkdownRenderer content={message.content} />
          )}
          {message.streaming && (
            <span
              aria-hidden="true"
              className="inline-block h-4 w-1 animate-pulse motion-reduce:animate-none bg-primary ml-0.5"
            />
          )}
        </div>
        {/* Activity feed (collapsed pill) — when agent steps exist, replaces pipeline-only bar */}
        {showSteps && !isUser && message.activityFeed && message.activityFeed.totalSteps > 0 && (
          <LiveActivityFeed
            phases={message.pipeline ?? []}
            feed={message.activityFeed}
            isLive={false}
          />
        )}
        {/* Pipeline summary bar — fallback when only conductor phases exist (no agent steps) */}
        {showSteps &&
          !isUser &&
          !message.activityFeed &&
          message.pipeline &&
          message.pipeline.length > 0 && <PipelineSummaryBar phases={message.pipeline} />}
      </div>
    </div>
  );
});
