'use client';

import type {
  AgentRuntimeInfo,
  ConductorDebugPayload,
  WSClientMessage,
  WSServerMessage,
} from '@autonomy/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface PipelinePhase {
  phase: string;
  message: string;
  timestamp: number;
  durationMs?: number;
  debug?: ConductorDebugPayload;
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
  isProcessing?: boolean;
}

interface UseWebSocketOptions {
  url: string;
  onAgentStatus?: (agents: AgentRuntimeInfo[], conductorName?: string) => void;
}

export function useWebSocket({ url, onAgentStatus }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const accumulatorRef = useRef<{ content: string; agentId: string; id: string } | null>(null);
  const pipelineRef = useRef<PipelinePhase[]>([]);
  const processingIdRef = useRef<string | null>(null);
  const onAgentStatusRef = useRef(onAgentStatus);
  onAgentStatusRef.current = onAgentStatus;

  function handleChunk(content: string, agentId: string) {
    if (!accumulatorRef.current) {
      const id = `msg-${Date.now()}`;
      accumulatorRef.current = { content, agentId, id };
      const pipeline = pipelineRef.current.length > 0 ? [...pipelineRef.current] : undefined;
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
    setIsProcessing(false);
    const finalPipeline = pipelineRef.current.length > 0 ? pipelineRef.current.slice() : undefined;
    if (accumulatorRef.current) {
      const acc = accumulatorRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === acc.id ? { ...m, streaming: false, pipeline: finalPipeline ?? m.pipeline } : m,
        ),
      );
      accumulatorRef.current = null;
    } else if (processingIdRef.current) {
      const procId = processingIdRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === procId
            ? { ...m, isProcessing: false, pipeline: finalPipeline ?? m.pipeline }
            : m,
        ),
      );
    }
    processingIdRef.current = null;
    pipelineRef.current = [];
  }

  function handleError(message: string) {
    setIsProcessing(false);
    accumulatorRef.current = null;
    const errorPipeline = pipelineRef.current.length > 0 ? [...pipelineRef.current] : undefined;
    pipelineRef.current = [];
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
          case 'agent_status':
            onAgentStatusRef.current?.(parsed.agents, parsed.conductorName);
            break;
          case 'pong':
            break;
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
        setIsProcessing(false);
        accumulatorRef.current = null;
        processingIdRef.current = null;
        pipelineRef.current = [];
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

  const sendMessage = useCallback((content: string, targetAgent?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    const wsMsg: WSClientMessage = {
      type: 'message',
      content,
      targetAgent,
    };
    wsRef.current.send(JSON.stringify(wsMsg));
  }, []);

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

  return { status, messages, sendMessage, isProcessing };
}
