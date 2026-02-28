'use client';

import type {
  AgentRuntimeInfo,
  ConductorDebugPayload,
  WSClientMessage,
  WSServerMessage,
} from '@autonomy/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Maximum characters stored per tool's accumulated input before truncation. */
const MAX_INPUT_BYTES = 10_240;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface PipelinePhase {
  phase: string;
  message: string;
  timestamp: number;
  durationMs?: number;
  debug?: ConductorDebugPayload;
}

export type ToolCallStatus = 'streaming' | 'complete';

export interface AgentToolCall {
  toolId: string;
  toolName: string;
  accumulatedInput: string;
  status: ToolCallStatus;
  durationMs?: number;
  startedAt: number;
  completedAt?: number;
}

export interface AgentThinking {
  content: string;
  timestamp: number;
}

export interface AgentActivity {
  agentId: string;
  agentName?: string;
  toolCalls: AgentToolCall[];
  thinkingBlocks: AgentThinking[];
}

export interface ActivityFeed {
  agents: AgentActivity[];
  totalSteps: number;
  totalDurationMs: number;
  isActive: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: number;
  streaming?: boolean;
  pipeline?: PipelinePhase[];
  activityFeed?: ActivityFeed;
  isProcessing?: boolean;
}

interface UseWebSocketOptions {
  url: string;
  onAgentStatus?: (agents: AgentRuntimeInfo[], conductorName?: string) => void;
  onSessionInit?: (sessionId: string) => void;
  initialMessages?: ChatMessage[];
}

export function useWebSocket({
  url,
  onAgentStatus,
  onSessionInit,
  initialMessages,
}: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const accumulatorRef = useRef<{ content: string; agentId: string; id: string } | null>(null);
  const pipelineRef = useRef<PipelinePhase[]>([]);
  const processingIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const onAgentStatusRef = useRef(onAgentStatus);
  onAgentStatusRef.current = onAgentStatus;
  const onSessionInitRef = useRef(onSessionInit);
  onSessionInitRef.current = onSessionInit;

  // Agent step accumulation refs — never triggers renders directly
  // Map<agentId, AgentActivity> for O(1) lookup during streaming
  const agentActivitiesRef = useRef<Map<string, AgentActivity>>(new Map());
  // Map<toolId, agentId> for routing tool_input/tool_complete to the right agent
  const toolToAgentRef = useRef<Map<string, string>>(new Map());

  function buildActivityFeed(isActive: boolean): ActivityFeed {
    const agents = Array.from(agentActivitiesRef.current.values());
    let totalDurationMs = 0;
    let totalSteps = 0;
    for (const agent of agents) {
      totalSteps += agent.toolCalls.length + agent.thinkingBlocks.length;
      for (const tc of agent.toolCalls) {
        totalDurationMs += tc.durationMs ?? 0;
      }
    }
    return { agents, totalSteps, totalDurationMs, isActive };
  }

  function flushActivityToProcessingMessage(isActive: boolean) {
    // Target the processing placeholder OR the live streaming assistant message (whichever is active).
    // After the first text chunk, processingIdRef is null but accumulatorRef is set —
    // without this fallback, tool_start/tool_complete events during text streaming are no-ops.
    const procId = processingIdRef.current;
    const accId = accumulatorRef.current?.id;
    const targetId = procId ?? accId;
    if (!targetId) return;
    const feed = buildActivityFeed(isActive);
    setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, activityFeed: feed } : m)));
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: agent step handler processes many event types
  function handleAgentStep(parsed: WSServerMessage & { type: 'agent_step' }) {
    if (cancelledRef.current) return;

    switch (parsed.stepType) {
      case 'tool_start': {
        const agentId = parsed.agentId;
        const toolId = parsed.toolId;
        const toolName = parsed.toolName ?? 'unknown';
        if (!toolId) return;

        const newTool: AgentToolCall = {
          toolId,
          toolName,
          accumulatedInput: '',
          status: 'streaming',
          startedAt: Date.now(),
        };

        // Always create a new AgentActivity object so React.memo sees a changed reference
        // and re-renders AgentSection + ToolCallRow. Mutating in place would be invisible
        // to memo's shallow-equality check.
        const existing = agentActivitiesRef.current.get(agentId);
        const newAgent: AgentActivity = existing
          ? { ...existing, toolCalls: [...existing.toolCalls, newTool] }
          : {
              agentId,
              agentName: parsed.agentName,
              toolCalls: [newTool],
              thinkingBlocks: [],
            };
        agentActivitiesRef.current.set(agentId, newAgent);
        toolToAgentRef.current.set(toolId, agentId);

        flushActivityToProcessingMessage(true);
        break;
      }

      case 'tool_input': {
        const toolId = parsed.toolId;
        if (!toolId || !parsed.inputDelta) return;
        const agentId = toolToAgentRef.current.get(toolId);
        if (!agentId) return;
        const agent = agentActivitiesRef.current.get(agentId);
        if (!agent) return;
        const tool = agent.toolCalls.find((tc) => tc.toolId === toolId);
        if (!tool) return;

        // Accumulate directly — no flush here (one render per tool_input would be expensive).
        // The accumulated input is captured on the next flush (tool_complete or a flush triggered
        // by an immutable update to the agent's toolCalls array).
        if (tool.accumulatedInput.length < MAX_INPUT_BYTES) {
          tool.accumulatedInput += parsed.inputDelta;
          if (tool.accumulatedInput.length > MAX_INPUT_BYTES) {
            tool.accumulatedInput = `${tool.accumulatedInput.slice(0, MAX_INPUT_BYTES)}\n[truncated]`;
          }
        }
        break;
      }

      case 'tool_complete': {
        const toolId = parsed.toolId;
        if (!toolId) return;
        const agentId = toolToAgentRef.current.get(toolId);
        if (!agentId) return;
        const agent = agentActivitiesRef.current.get(agentId);
        if (!agent) return;
        const toolIdx = agent.toolCalls.findIndex((tc) => tc.toolId === toolId);
        if (toolIdx === -1) return;

        // Create a new array with a new tool object at toolIdx — preserves accumulatedInput
        // (which may have been mutated by tool_input events) while ensuring a new reference
        // that React.memo will detect.
        const existingTool = agent.toolCalls[toolIdx];
        if (!existingTool) return; // noUncheckedIndexedAccess guard — toolIdx is guaranteed valid via findIndex above
        const newToolCalls = [...agent.toolCalls];
        newToolCalls[toolIdx] = {
          ...existingTool,
          status: 'complete',
          durationMs: parsed.durationMs,
          completedAt: Date.now(),
        };
        agentActivitiesRef.current.set(agentId, { ...agent, toolCalls: newToolCalls });
        toolToAgentRef.current.delete(toolId);

        flushActivityToProcessingMessage(true);
        break;
      }

      case 'thinking': {
        const agentId = parsed.agentId;
        const newThink: AgentThinking = {
          content: parsed.content ?? '',
          timestamp: Date.now(),
        };

        const existing = agentActivitiesRef.current.get(agentId);
        const newAgent: AgentActivity = existing
          ? { ...existing, thinkingBlocks: [...existing.thinkingBlocks, newThink] }
          : {
              agentId,
              agentName: parsed.agentName,
              toolCalls: [],
              thinkingBlocks: [newThink],
            };
        agentActivitiesRef.current.set(agentId, newAgent);

        flushActivityToProcessingMessage(true);
        break;
      }
    }
  }

  function clearActivityRefs() {
    agentActivitiesRef.current = new Map();
    toolToAgentRef.current = new Map();
  }

  function handleChunk(content: string, agentId: string) {
    if (cancelledRef.current) return;
    if (!accumulatorRef.current) {
      const id = `msg-${Date.now()}`;
      accumulatorRef.current = { content, agentId, id };
      const pipeline = pipelineRef.current.length > 0 ? [...pipelineRef.current] : undefined;
      const activityFeed =
        agentActivitiesRef.current.size > 0 ? buildActivityFeed(false) : undefined;
      const procId = processingIdRef.current;
      processingIdRef.current = null;
      setMessages((prev) => {
        const filtered = procId ? prev.filter((m) => m.id !== procId) : prev;
        return [
          ...filtered,
          {
            id,
            role: 'assistant',
            content,
            agentId,
            timestamp: Date.now(),
            streaming: true,
            pipeline,
            activityFeed,
          },
        ];
      });
    } else {
      accumulatorRef.current.content += content;
      const acc = accumulatorRef.current;
      setMessages((prev) =>
        prev.map((m) => (m.id === acc.id ? { ...m, content: acc.content } : m)),
      );
    }
  }

  function handleComplete() {
    if (cancelledRef.current) return;
    setIsProcessing(false);
    const finalPipeline = pipelineRef.current.length > 0 ? pipelineRef.current.slice() : undefined;
    const finalFeed = agentActivitiesRef.current.size > 0 ? buildActivityFeed(false) : undefined;
    if (accumulatorRef.current) {
      const acc = accumulatorRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === acc.id
            ? {
                ...m,
                streaming: false,
                pipeline: finalPipeline ?? m.pipeline,
                activityFeed: finalFeed ?? m.activityFeed,
              }
            : m,
        ),
      );
      accumulatorRef.current = null;
    } else if (processingIdRef.current) {
      const procId = processingIdRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === procId
            ? {
                ...m,
                isProcessing: false,
                pipeline: finalPipeline ?? m.pipeline,
                activityFeed: finalFeed ?? m.activityFeed,
              }
            : m,
        ),
      );
    }
    processingIdRef.current = null;
    pipelineRef.current = [];
    clearActivityRefs();
  }

  function handleError(message: string) {
    setIsProcessing(false);
    accumulatorRef.current = null;
    const errorPipeline = pipelineRef.current.length > 0 ? [...pipelineRef.current] : undefined;
    const errorFeed = agentActivitiesRef.current.size > 0 ? buildActivityFeed(false) : undefined;
    pipelineRef.current = [];
    clearActivityRefs();
    const procId = processingIdRef.current;
    processingIdRef.current = null;
    setMessages((prev) => {
      const filtered = procId ? prev.filter((m) => m.id !== procId) : prev;
      return [
        ...filtered,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${message}`,
          timestamp: Date.now(),
          pipeline: errorPipeline,
          activityFeed: errorFeed,
        },
      ];
    });
  }

  function handleConductorStatus(parsed: {
    phase: string;
    message: string;
    agentName?: string;
    debug?: ConductorDebugPayload;
  }) {
    if (cancelledRef.current) return;
    const phase: PipelinePhase = {
      phase: parsed.phase,
      message: parsed.message,
      timestamp: Date.now(),
      durationMs: parsed.debug?.durationMs,
      debug: parsed.debug,
    };
    pipelineRef.current.push(phase);
    const currentPipeline = pipelineRef.current.slice();

    if (!processingIdRef.current) {
      const id = `processing-${Date.now()}`;
      processingIdRef.current = id;
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: 'system',
          content: parsed.message,
          agentName: parsed.agentName,
          timestamp: Date.now(),
          pipeline: currentPipeline,
          isProcessing: true,
        },
      ]);
    } else {
      const procId = processingIdRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === procId ? { ...m, content: parsed.message, pipeline: currentPipeline } : m,
        ),
      );
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup/scheduleReconnect only use refs — no stale closure risk
  const connect = useCallback(() => {
    const current = wsRef.current;
    if (current?.readyState === WebSocket.OPEN || current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Clean up any lingering ping interval from previous connection
    cleanup();

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        setStatus('connected');
        retryCountRef.current = 0;

        // Start ping interval
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const msg: WSClientMessage = { type: 'ping' };
            ws.send(JSON.stringify(msg));
          }
        }, 30_000);
      };

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: WebSocket message handler dispatches many event types
      ws.onmessage = (event) => {
        let parsed: WSServerMessage;
        try {
          parsed = JSON.parse(event.data as string) as WSServerMessage;
        } catch {
          return;
        }

        switch (parsed.type) {
          case 'chunk':
            handleChunk(parsed.content, parsed.agentId);
            break;
          case 'complete':
            handleComplete();
            break;
          case 'error':
            handleError(parsed.message);
            break;
          case 'conductor_status':
            handleConductorStatus(parsed);
            break;
          case 'agent_step':
            handleAgentStep(parsed);
            break;
          case 'agent_status':
            onAgentStatusRef.current?.(parsed.agents, parsed.conductorName);
            break;
          case 'session_init':
            onSessionInitRef.current?.(parsed.sessionId);
            break;
          case 'stream_resume': {
            // Server is replaying buffered content from a stream that started before reconnect
            if (parsed.streaming) {
              setIsProcessing(true);
              if (parsed.content) {
                // We already have partial content — show as streaming message
                const id = `msg-${Date.now()}`;
                accumulatorRef.current = { content: parsed.content, agentId: parsed.agentId, id };
                setMessages((prev) => [
                  ...prev,
                  {
                    id,
                    role: 'assistant',
                    content: parsed.content,
                    agentId: parsed.agentId,
                    timestamp: Date.now(),
                    streaming: true,
                  },
                ]);
              } else {
                // No content yet — show processing indicator so the user sees feedback;
                // handleChunk will replace it when the first real chunk arrives
                const id = `processing-${Date.now()}`;
                processingIdRef.current = id;
                setMessages((prev) => [
                  ...prev,
                  {
                    id,
                    role: 'system',
                    content: 'Responding...',
                    timestamp: Date.now(),
                    isProcessing: true,
                  },
                ]);
              }
            } else {
              // Already complete — add as a finished message
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-${Date.now()}`,
                  role: 'assistant',
                  content: parsed.content,
                  agentId: parsed.agentId,
                  timestamp: Date.now(),
                  streaming: false,
                },
              ]);
            }
            break;
          }
          case 'pong':
            break;
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
        setIsProcessing(false);
        if (accumulatorRef.current) {
          const acc = accumulatorRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === acc.id ? { ...m, streaming: false } : m)),
          );
          accumulatorRef.current = null;
        }
        if (processingIdRef.current) {
          const procId = processingIdRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === procId ? { ...m, isProcessing: false } : m)),
          );
          processingIdRef.current = null;
        }
        pipelineRef.current = [];
        clearActivityRefs();
        cleanup();
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      setStatus('disconnected');
      scheduleReconnect();
    }
  }, [url]);

  function cleanup() {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  }

  function scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
    retryCountRef.current += 1;
    reconnectRef.current = setTimeout(connect, delay);
  }

  const sendMessage = useCallback(
    (content: string, targetAgent?: string, options?: { silent?: boolean }) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      // Re-arm guard so new responses aren't suppressed after a previous cancel
      cancelledRef.current = false;

      if (!options?.silent) {
        const userMsg: ChatMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setIsProcessing(true);
      }

      const wsMsg: WSClientMessage = {
        type: 'message',
        content,
        targetAgent,
      };
      wsRef.current.send(JSON.stringify(wsMsg));
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup only uses refs — stable across renders
  useEffect(() => {
    connect();
    return () => {
      cleanup();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: buildActivityFeed and clearActivityRefs only read from refs — stable across renders
  const cancelProcessing = useCallback(() => {
    cancelledRef.current = true;
    setIsProcessing(false);

    // Send cancel message to server so it aborts the backend CLI process
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const cancelMsg: WSClientMessage = { type: 'cancel' };
      wsRef.current.send(JSON.stringify(cancelMsg));
    }

    const procId = processingIdRef.current;
    const accumId = accumulatorRef.current?.id;
    const errorPipeline = pipelineRef.current.length > 0 ? [...pipelineRef.current] : undefined;
    const cancelFeed = agentActivitiesRef.current.size > 0 ? buildActivityFeed(false) : undefined;
    accumulatorRef.current = null;
    processingIdRef.current = null;
    pipelineRef.current = [];
    clearActivityRefs();
    setMessages((prev) =>
      prev.map((m) => {
        // Update the system/processing placeholder (if still present)
        if (procId && m.id === procId) {
          return {
            ...m,
            isProcessing: false,
            content: 'Request cancelled',
            pipeline: errorPipeline,
            activityFeed: cancelFeed,
          };
        }
        // Stop the streaming cursor on a mid-stream assistant message
        if (accumId && m.id === accumId && m.streaming) {
          return { ...m, streaming: false, activityFeed: cancelFeed };
        }
        return m;
      }),
    );
  }, []);

  return { status, messages, sendMessage, isProcessing, cancelProcessing };
}
