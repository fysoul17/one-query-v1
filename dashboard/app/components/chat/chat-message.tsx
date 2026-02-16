import { Bot, Cpu, User } from 'lucide-react';
import type { ChatMessage } from '@/hooks/use-websocket';

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
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

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-primary/10' : 'bg-neon-purple/10'
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary" />
        ) : (
          <Bot className="h-4 w-4 text-neon-purple" />
        )}
      </div>
      <div className={`max-w-[80%] space-y-1 ${isUser ? 'items-end' : ''}`}>
        {!isUser && (message.agentName || message.agentId) && (
          <span className="text-[10px] font-mono text-neon-purple text-glow-purple">
            {message.agentName ?? message.agentId}
          </span>
        )}
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'glass border-primary/20 text-foreground'
              : 'glass border-neon-purple/20 text-foreground'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          {message.streaming && (
            <span className="inline-block h-4 w-1 animate-pulse bg-primary ml-0.5" />
          )}
        </div>
      </div>
    </div>
  );
}
