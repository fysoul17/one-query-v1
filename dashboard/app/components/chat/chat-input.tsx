'use client';

import { Send } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ConnectionStatus } from '@/hooks/use-websocket';

interface ChatInputProps {
  onSend: (content: string) => void;
  status: ConnectionStatus;
  isProcessing?: boolean;
}

export function ChatInput({ onSend, status, isProcessing }: ChatInputProps) {
  const [value, setValue] = useState('');
  const disabled = status !== 'connected' || !value.trim() || !!isProcessing;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    onSend(value.trim());
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled) {
        onSend(value.trim());
        setValue('');
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-4">
      <div className="relative flex-1">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            status !== 'connected'
              ? 'Connecting...'
              : isProcessing
                ? 'Processing...'
                : 'Send a message...'
          }
          disabled={status !== 'connected'}
          rows={1}
          className="w-full resize-none rounded-lg border border-input bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:glow-cyan focus:outline-none disabled:opacity-50"
        />
      </div>
      <Button
        type="submit"
        size="icon"
        disabled={disabled}
        aria-label={isProcessing ? 'Processing, please wait' : 'Send message'}
        className="shrink-0 glow-cyan"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
