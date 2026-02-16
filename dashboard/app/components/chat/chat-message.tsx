import { Bot, Cpu, User } from 'lucide-react';
import type { ChatMessage } from '@/hooks/use-websocket';
import { PipelineSummaryBar } from './pipeline-summary-bar';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  debugMode?: boolean;
}

function AvatarIcon({ isUser, isConductor }: { isUser: boolean; isConductor: boolean }) {
  if (isUser) return <User className="h-4 w-4 text-primary" />;
  if (isConductor) return <Cpu className="h-4 w-4 text-neon-cyan" />;
  return <Bot className="h-4 w-4 text-neon-purple" />;
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

export function ChatMessageBubble({ message, debugMode }: ChatMessageBubbleProps) {
  if (message.role === 'system') {
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
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          {message.streaming && (
            <span className="inline-block h-4 w-1 animate-pulse bg-primary ml-0.5" />
          )}
        </div>
        {debugMode && !isUser && message.pipeline && message.pipeline.length > 0 && (
          <PipelineSummaryBar phases={message.pipeline} />
        )}
      </div>
    </div>
  );
}
