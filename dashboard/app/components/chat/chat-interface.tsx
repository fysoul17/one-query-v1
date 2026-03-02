'use client';

import type { AgentRuntimeInfo, BackendConfigOption } from '@autonomy/shared';
import { Layers, Plus, Terminal } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSlashCommands } from '@/hooks/use-backend-options';
import { useDebugWebSocket } from '@/hooks/use-debug-websocket';
import { useProcessingTimer } from '@/hooks/use-processing-timer';
import { useShowSteps } from '@/hooks/use-show-steps';
import type { ActivityFeed, PipelinePhase } from '@/hooks/use-websocket';
import { useWebSocket } from '@/hooks/use-websocket';
import { RUNTIME_WS_URL } from '@/lib/constants';
import { AgentSelector } from './agent-selector';
import { ChatInput } from './chat-input';
import { ChatMessageBubble } from './chat-message';
import { DebugConsole } from './debug-console';
import { ModelSelector } from './model-selector';

const WS_BASE = `${RUNTIME_WS_URL}/ws/chat`;

/**
 * Regex to parse system confirmations like: **model** set to **opus** for this session.
 * COUPLING: This must match the exact format produced by sendSystemMessage() in
 * packages/server/src/websocket.ts handleSlashCommand(). If the server message format
 * changes, this regex must be updated to match.
 */
const CONFIG_CONFIRM_RE = /\*\*(\w+)\*\* set to \*\*(.+?)\*\* for this session\./;

interface ChatInterfaceProps {
  initialAgents: AgentRuntimeInfo[];
  initialSessionId?: string;
  initialMessages?: {
    role: string;
    content: string;
    agentId?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }[];
  backendOptions?: BackendConfigOption[];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: chat interface requires complex state management
export function ChatInterface({
  initialAgents,
  initialSessionId,
  initialMessages,
  backendOptions = [],
}: ChatInterfaceProps) {
  const [agents, setAgents] = useState<AgentRuntimeInfo[]>(initialAgents);
  const [targetAgent, setTargetAgent] = useState<string | undefined>(undefined);
  const [conductorName, setConductorName] = useState('Conductor');
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [configOverrides, setConfigOverrides] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const { showSteps, toggleSteps } = useShowSteps();
  const [showDebug, setShowDebug] = useState(false);

  const {
    status: debugStatus,
    events: debugEvents,
    clearEvents: clearDebugEvents,
  } = useDebugWebSocket({ enabled: showDebug });

  const slashCommands = useSlashCommands(backendOptions);

  const wsUrl = initialSessionId ? `${WS_BASE}?sessionId=${initialSessionId}` : WS_BASE;

  // biome-ignore lint/correctness/useExhaustiveDependencies: only compute seed messages once on mount
  const seedMessages = useMemo(
    () =>
      initialMessages?.map((m, i) => {
        // Restore pipeline and activityFeed from persisted metadata
        const meta = m.metadata as
          | { pipeline?: PipelinePhase[]; activityFeed?: ActivityFeed }
          | undefined;
        return {
          id: `seed-${i}-${Date.now()}`,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          agentId: m.agentId,
          timestamp: Date.parse(m.createdAt),
          pipeline: meta?.pipeline,
          activityFeed: meta?.activityFeed,
        };
      }),
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

  const { status, messages, sendMessage, isProcessing, cancelProcessing } = useWebSocket({
    url: wsUrl,
    onAgentStatus: handleAgentStatus,
    onSessionInit: handleSessionInit,
    initialMessages: seedMessages,
  });

  const { elapsedMs, warning } = useProcessingTimer(isProcessing);

  // Watch messages for system confirmations to keep configOverrides in sync
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.streaming) return;
    if (last.role !== 'assistant' || last.agentId !== 'system') return;

    const match = CONFIG_CONFIRM_RE.exec(last.content);
    if (match?.[1] && match[2]) {
      const name = match[1];
      const value = match[2];
      setConfigOverrides((prev) => ({ ...prev, [name]: value }));
    }
  }, [messages]);

  // Smart scroll: scroll on send always, scroll on incoming only when near bottom
  const isNearBottomRef = useRef(true);
  const userSentRef = useRef(false);
  const SCROLL_THRESHOLD = 100;

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }

  // Scroll to bottom on initial mount (session with history)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
  useEffect(() => {
    scrollToBottom();
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
  }, []);

  const lastMessage = messages[messages.length - 1];
  // Include activityFeed.totalSteps so auto-scroll fires when tool events expand the feed height.
  // Without this, new tool calls grow the processing message below the viewport and are never shown.
  const activitySteps = lastMessage?.activityFeed?.totalSteps ?? 0;
  const scrollTrigger = `${messages.length}-${lastMessage?.content?.length ?? 0}-${activitySteps}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on message count, content change, and activity feed steps
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
      const isSlashCommand = content.startsWith('/');
      sendMessage(content, targetAgent, isSlashCommand ? { silent: true } : undefined);
    },
    [sendMessage, targetAgent],
  );

  const handleOptionChange = useCallback(
    (name: string, value: string) => {
      userSentRef.current = true;
      sendMessage(`/${name} ${value}`, targetAgent, { silent: true });
    },
    [sendMessage, targetAgent],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Agent selector + model selector + new chat */}
      <div className="flex shrink-0 items-center border-b border-border">
        <div className="flex-1 overflow-hidden">
          <AgentSelector
            agents={agents}
            selected={targetAgent}
            onSelect={setTargetAgent}
            conductorName={conductorName}
          />
        </div>
        {backendOptions.some((o) => o.name === 'model' && o.values) && (
          <>
            <div className="h-5 w-px bg-border/50" />
            <ModelSelector
              options={backendOptions}
              currentOverrides={configOverrides}
              onChangeOption={handleOptionChange}
            />
          </>
        )}
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
        aria-busy={isProcessing}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-medium text-muted-foreground">
                {targetAgent
                  ? `Chat with ${agents.find((a) => a.id === targetAgent)?.name ?? 'agent'}`
                  : `Chat with ${conductorName}`}
              </p>
              <p className="text-sm text-muted-foreground">Send a message to get started.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                showSteps={showSteps}
                elapsedMs={msg.isProcessing ? elapsedMs : undefined}
                warning={msg.isProcessing ? warning : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Debug console panel */}
      {showDebug && (
        <DebugConsole
          events={debugEvents}
          connectionStatus={debugStatus}
          onClear={clearDebugEvents}
          onClose={() => setShowDebug(false)}
        />
      )}

      {/* Connection status + steps toggle */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border/50 px-4 py-1">
        {/* <output> announces connection changes to screen readers */}
        <output className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              status === 'connected'
                ? 'bg-status-green status-pulse-green'
                : status === 'connecting'
                  ? 'bg-status-amber'
                  : 'bg-status-red'
            }`}
          />
          <span className="text-[10px] text-muted-foreground capitalize">{status}</span>
        </output>
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
              ? 'bg-muted text-foreground border border-border'
              : 'text-muted-foreground/50 hover:text-muted-foreground'
          }`}
        >
          <Layers className="h-3 w-3" />
          <span>Steps</span>
        </button>
        <button
          type="button"
          onClick={() => setShowDebug((v) => !v)}
          aria-label={showDebug ? 'Hide debug console' : 'Show debug console'}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
            showDebug
              ? 'bg-status-amber/10 text-status-amber border border-status-amber/20'
              : 'text-muted-foreground/50 hover:text-muted-foreground'
          }`}
        >
          <Terminal className="h-3 w-3" />
          <span>Debug</span>
          {debugEvents.length > 0 && (
            <span className="text-muted-foreground/40">{debugEvents.length}</span>
          )}
        </button>
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onCancel={cancelProcessing}
        status={status}
        isProcessing={isProcessing}
        slashCommands={slashCommands}
      />
    </div>
  );
}
