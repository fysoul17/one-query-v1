'use client';

import type { AgentRuntimeInfo } from '@autonomy/shared';
import { Layers, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShowSteps } from '@/hooks/use-show-steps';
import { useWebSocket } from '@/hooks/use-websocket';
import { AgentSelector } from './agent-selector';
import { ChatInput } from './chat-input';
import { ChatMessageBubble } from './chat-message';

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? 'http://localhost:7820';
const WS_BASE = `${RUNTIME_URL.replace(/^http/, 'ws')}/ws/chat`;

interface ChatInterfaceProps {
  initialAgents: AgentRuntimeInfo[];
  initialSessionId?: string;
  initialMessages?: { role: string; content: string; agentId?: string; createdAt: string }[];
}

export function ChatInterface({
  initialAgents,
  initialSessionId,
  initialMessages,
}: ChatInterfaceProps) {
  const [agents, setAgents] = useState<AgentRuntimeInfo[]>(initialAgents);
  const [targetAgent, setTargetAgent] = useState<string | undefined>(undefined);
  const [conductorName, setConductorName] = useState('Conductor');
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { showSteps, toggleSteps } = useShowSteps();

  const wsUrl = initialSessionId ? `${WS_BASE}?sessionId=${initialSessionId}` : WS_BASE;

  // biome-ignore lint/correctness/useExhaustiveDependencies: only compute seed messages once on mount
  const seedMessages = useMemo(
    () =>
      initialMessages?.map((m, i) => ({
        id: `seed-${i}-${Date.now()}`,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        agentId: m.agentId,
        timestamp: Date.parse(m.createdAt),
      })),
    [],
  );

  const handleAgentStatus = useCallback(
    (newAgents: AgentRuntimeInfo[], newConductorName?: string) => {
      setAgents(newAgents);
      if (newConductorName) setConductorName(newConductorName);
    },
    [],
  );

  const handleSessionInit = useCallback((newSessionId: string) => {
    setSessionId(newSessionId);
    // Update URL so navigating away and back preserves the session
    window.history.replaceState(null, '', `/chat?sessionId=${newSessionId}`);
  }, []);

  // Remember the current session in a cookie so the server can restore it
  // when the user navigates away and comes back to /chat.
  useEffect(() => {
    if (sessionId) {
      // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API has limited browser support
      document.cookie = `lastChatSession=${sessionId};path=/;max-age=31536000;SameSite=Lax`;
    }
  }, [sessionId]);

  const { status, messages, sendMessage, isProcessing } = useWebSocket({
    url: wsUrl,
    onAgentStatus: handleAgentStatus,
    onSessionInit: handleSessionInit,
    initialMessages: seedMessages,
  });

  // Smart scroll: scroll on send always, scroll on incoming only when near bottom
  const isNearBottomRef = useRef(true);
  const userSentRef = useRef(false);
  const SCROLL_THRESHOLD = 100;

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
  }, []);

  const lastMessage = messages[messages.length - 1];
  const scrollTrigger = `${messages.length}-${lastMessage?.content?.length ?? 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on message count and content change
  useEffect(() => {
    if (userSentRef.current) {
      scrollToBottom();
      userSentRef.current = false;
    } else if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [scrollTrigger]);

  const handleSend = useCallback(
    (content: string) => {
      userSentRef.current = true;
      sendMessage(content, targetAgent);
    },
    [sendMessage, targetAgent],
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* Agent selector + new chat */}
      <div className="flex items-center border-b border-border">
        <div className="flex-1 overflow-hidden">
          <AgentSelector
            agents={agents}
            selected={targetAgent}
            onSelect={setTargetAgent}
            conductorName={conductorName}
          />
        </div>
        <Link
          href="/chat?new"
          aria-label="New chat"
          className="flex shrink-0 items-center gap-1 border-l border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Chat</span>
        </Link>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-busy={isProcessing}
        className="flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-medium text-muted-foreground">
                {targetAgent
                  ? `Chat with ${agents.find((a) => a.id === targetAgent)?.name ?? 'agent'}`
                  : `Chat with ${conductorName}`}
              </p>
              <p className="text-sm text-muted-foreground/60">Send a message to get started.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatMessageBubble key={msg.id} message={msg} showSteps={showSteps} />
            ))}
          </div>
        )}
      </div>

      {/* Connection status + steps toggle */}
      <div className="flex items-center gap-2 border-t border-border/50 px-4 py-1">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full animate-pulse-glow ${
            status === 'connected'
              ? 'bg-neon-cyan'
              : status === 'connecting'
                ? 'bg-neon-amber'
                : 'bg-neon-red'
          }`}
        />
        <span className="text-[10px] text-muted-foreground capitalize">{status}</span>
        {sessionId && (
          <output
            className="text-[10px] text-muted-foreground/50 font-mono"
            title={sessionId}
            aria-label={`Session ID: ${sessionId}`}
          >
            {sessionId.slice(0, 8)}
          </output>
        )}

        <button
          type="button"
          onClick={toggleSteps}
          aria-label={showSteps ? 'Hide processing steps' : 'Show processing steps'}
          className={`ml-auto flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
            showSteps
              ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20'
              : 'text-muted-foreground/50 hover:text-muted-foreground'
          }`}
        >
          <Layers className="h-3 w-3" />
          <span>Steps</span>
        </button>
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} status={status} isProcessing={isProcessing} />
    </div>
  );
}
