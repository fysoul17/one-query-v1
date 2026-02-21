'use client';

import { Send, Square } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SlashCommand } from '@/hooks/use-backend-options';
import type { ConnectionStatus } from '@/hooks/use-websocket';
import { SlashAutocomplete } from './slash-autocomplete';

interface ChatInputProps {
  onSend: (content: string) => void;
  onCancel?: () => void;
  status: ConnectionStatus;
  isProcessing?: boolean;
  slashCommands?: SlashCommand[];
}

export function ChatInput({
  onSend,
  onCancel,
  status,
  isProcessing,
  slashCommands = [],
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [autocompleteDismissed, setAutocompleteDismissed] = useState(false);
  const disabled = status !== 'connected' || !value.trim() || !!isProcessing;

  // Show autocomplete when typing a command name (starts with /, no space yet)
  const showAutocomplete =
    value.startsWith('/') &&
    !value.includes(' ') &&
    !autocompleteDismissed &&
    slashCommands.length > 0;
  const prefix = value.slice(1).toLowerCase();

  const filteredCommands = useMemo(() => {
    if (!showAutocomplete) return [];
    return slashCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(prefix));
  }, [showAutocomplete, slashCommands, prefix]);

  const isAutocompleteOpen = showAutocomplete && filteredCommands.length > 0;

  const handleSelect = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.values) {
        setValue(`/${cmd.name} `);
      } else {
        onSend(`/${cmd.name}`);
        setValue('');
      }
      setActiveIndex(0);
      setAutocompleteDismissed(false);
    },
    [onSend],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    onSend(value.trim());
    setValue('');
    setActiveIndex(0);
    setAutocompleteDismissed(false);
  }

  function handleAutocompleteKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filteredCommands.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands[activeIndex];
      if (cmd) handleSelect(cmd);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setAutocompleteDismissed(true);
      setActiveIndex(0);
      return true;
    }
    return false;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (isAutocompleteOpen && handleAutocompleteKeyDown(e)) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled) {
        onSend(value.trim());
        setValue('');
        setActiveIndex(0);
        setAutocompleteDismissed(false);
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    setActiveIndex(0);
    // Only reset dismissal when the user clears the field or moves away from a slash command,
    // so Escape-then-type within the same command doesn't re-open the menu.
    if (!next.startsWith('/')) {
      setAutocompleteDismissed(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border p-4">
      <div className="relative flex-1">
        {isAutocompleteOpen && (
          <SlashAutocomplete
            commands={filteredCommands}
            activeIndex={activeIndex}
            onSelect={handleSelect}
          />
        )}
        <textarea
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            status !== 'connected'
              ? 'Connecting...'
              : isProcessing
                ? 'Processing...'
                : 'Send a message... (/ for commands)'
          }
          disabled={status !== 'connected'}
          rows={1}
          role="combobox"
          aria-expanded={isAutocompleteOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={isAutocompleteOpen ? 'slash-command-listbox' : undefined}
          aria-activedescendant={isAutocompleteOpen ? `slash-option-${activeIndex}` : undefined}
          aria-label="Chat message input"
          className="w-full resize-none rounded-lg border border-input bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:glow-cyan focus:outline-none disabled:opacity-50"
        />
      </div>
      {isProcessing && onCancel ? (
        <Button
          type="button"
          size="icon"
          onClick={onCancel}
          aria-label="Cancel processing"
          className="shrink-0 border-neon-red/50 text-neon-red hover:bg-neon-red/10"
          variant="outline"
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={disabled}
          aria-label="Send message"
          className="shrink-0 glow-cyan"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </form>
  );
}
