'use client';

import type { AgentRuntimeInfo, WSClientMessage, WSServerMessage } from '@autonomy/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: number;
  streaming?: boolean;
}

interface UseWebSocketOptions {
  url: string;
  onAgentStatus?: (agents: AgentRuntimeInfo[]) => void;
}

export function useWebSocket({ url, onAgentStatus }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);
  const accumulatorRef = useRef<{ content: string; agentId: string; id: string } | null>(null);
  const onAgentStatusRef = useRef(onAgentStatus);
  onAgentStatusRef.current = onAgentStatus;

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
          case 'chunk': {
            if (!accumulatorRef.current) {
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
              accumulatorRef.current.content += parsed.content;
              const acc = accumulatorRef.current;
              setMessages((prev) =>
                prev.map((m) => (m.id === acc.id ? { ...m, content: acc.content } : m)),
              );
            }
            break;
          }
          case 'complete': {
            if (accumulatorRef.current) {
              const acc = accumulatorRef.current;
              setMessages((prev) =>
                prev.map((m) => (m.id === acc.id ? { ...m, streaming: false } : m)),
              );
              accumulatorRef.current = null;
            }
            break;
          }
          case 'error': {
            accumulatorRef.current = null;
            setMessages((prev) => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                role: 'assistant',
                content: `Error: ${parsed.message}`,
                timestamp: Date.now(),
              },
            ]);
            break;
          }
          case 'conductor_status': {
            setMessages((prev) => [
              ...prev,
              {
                id: `status-${Date.now()}`,
                role: 'system',
                content: parsed.message,
                agentName: parsed.agentName,
                timestamp: Date.now(),
              },
            ]);
            break;
          }
          case 'agent_status': {
            onAgentStatusRef.current?.(parsed.agents);
            break;
          }
          case 'pong':
            break;
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
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

  return { status, messages, sendMessage };
}
