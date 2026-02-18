import type { Conductor, ConductorEvent, IncomingMessage } from '@autonomy/conductor';
import { ConductorEventType } from '@autonomy/conductor';
import type {
  ConductorDebugPayload,
  DebugEvent,
  WSClientMessage,
  WSServerAgentStatus,
  WSServerChunk,
  WSServerComplete,
  WSServerConductorStatus,
  WSServerError,
  WSServerPong,
  WSServerSessionInit,
} from '@autonomy/shared';
import {
  DebugEventCategory,
  DebugEventLevel,
  Logger,
  MessageRole,
  WSClientMessageType,
  WSServerMessageType,
} from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import type { DebugBus } from './debug-bus.ts';
import { makeDebugEvent } from './debug-bus.ts';
import type { SessionStore } from './session-store.ts';

const MAX_WS_MESSAGE_SIZE = 65_536; // 64 KB
const MAX_WS_CLIENTS = 100;
const WS_MSG_RATE_LIMIT = 10;
const WS_MSG_RATE_WINDOW_MS = 60_000;

const wsLogger = new Logger({ context: { source: 'websocket' } });

/** Per-socket message rate limiter. */
const socketMessageCounters = new Map<string, { count: number; resetAt: number }>();

function checkSocketMessageRate(socketId: string): boolean {
  const now = Date.now();
  let entry = socketMessageCounters.get(socketId);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WS_MSG_RATE_WINDOW_MS };
    socketMessageCounters.set(socketId, entry);
  }
  entry.count++;
  return entry.count <= WS_MSG_RATE_LIMIT;
}

export interface WSData {
  id: string;
  sessionId?: string;
}

function sendWSError(ws: ServerWebSocket<WSData>, message: string): void {
  const err: WSServerError = { type: WSServerMessageType.ERROR, message };
  ws.send(JSON.stringify(err));
}

function buildDebugPayload(event: ConductorEvent): ConductorDebugPayload | undefined {
  const debug: ConductorDebugPayload = {};
  let hasData = false;

  if (event.durationMs !== undefined) {
    debug.durationMs = event.durationMs;
    hasData = true;
  }
  if (event.memoryResults !== undefined) {
    debug.memoryResults = event.memoryResults;
    hasData = true;
  }
  if (event.routerType !== undefined) {
    debug.routerType = event.routerType;
    hasData = true;
  }
  if (event.content) {
    debug.routingReason = event.content;
    hasData = true;
  }
  if (event.decisions) {
    debug.decisions = event.decisions;
    hasData = true;
  }
  if (event.memoryQuery) {
    debug.memoryQuery = event.memoryQuery;
    hasData = true;
  }
  if (event.memoryEntryPreviews) {
    debug.memoryEntryPreviews = event.memoryEntryPreviews;
    hasData = true;
  }
  if (event.dispatchTarget) {
    debug.dispatchTarget = event.dispatchTarget;
    hasData = true;
  }

  return hasData ? debug : undefined;
}

function conductorEventToDebug(event: ConductorEvent): DebugEvent {
  const phaseMap: Record<string, string> = {
    [ConductorEventType.QUEUED]: 'Message queued',
    [ConductorEventType.DELEGATING]: 'Delegating to agent',
    [ConductorEventType.MEMORY_SEARCH]: 'Searching memory',
    [ConductorEventType.MEMORY_STORE]: 'Storing conversation',
    [ConductorEventType.DELEGATION_COMPLETE]: 'Delegation complete',
    [ConductorEventType.RESPONDING]: 'Conductor responding',
  };

  return makeDebugEvent({
    category: DebugEventCategory.CONDUCTOR,
    level: DebugEventLevel.INFO,
    source: `conductor.${event.type}`,
    message: event.content ?? phaseMap[event.type] ?? event.type,
    agentId: event.agentId,
    durationMs: event.durationMs,
    data: {
      ...(event.agentName && { agentName: event.agentName }),
      ...(event.memoryResults !== undefined && { memoryResults: event.memoryResults }),
      ...(event.memoryQuery && { memoryQuery: event.memoryQuery }),
      ...(event.routerType && { routerType: event.routerType }),
      ...(event.decisions && { decisions: event.decisions }),
      ...(event.dispatchTarget && { dispatchTarget: event.dispatchTarget }),
    },
  });
}

function sendConductorStatus(ws: ServerWebSocket<WSData>, event: ConductorEvent): void {
  let phase: WSServerConductorStatus['phase'];
  let message: string;

  switch (event.type) {
    case ConductorEventType.QUEUED:
      phase = 'queued';
      message = event.content ?? 'Message queued...';
      break;
    case ConductorEventType.DELEGATING:
      phase = 'delegating';
      message = 'Delegating to agent...';
      break;
    case ConductorEventType.MEMORY_SEARCH:
      phase = 'memory_search';
      message = event.content ?? 'Searching memory...';
      break;
    case ConductorEventType.MEMORY_STORE:
      phase = 'memory_store';
      message = event.content ?? 'Storing conversation...';
      break;
    case ConductorEventType.DELEGATION_COMPLETE:
      phase = 'delegation_complete';
      message = event.content ?? 'Delegation complete';
      break;
    case ConductorEventType.RESPONDING:
      phase = 'responding';
      message = event.content ?? 'Conductor is responding...';
      break;
    default:
      return;
  }

  const status: WSServerConductorStatus = {
    type: WSServerMessageType.CONDUCTOR_STATUS,
    phase,
    message,
    agentName: event.agentName,
    debug: buildDebugPayload(event),
  };
  ws.send(JSON.stringify(status));
}

async function handleConductorMessage(
  ws: ServerWebSocket<WSData>,
  conductor: Conductor,
  parsed: WSClientMessage,
  debugBus?: DebugBus,
  sessionStore?: SessionStore,
): Promise<void> {
  const incoming: IncomingMessage = {
    content: parsed.content ?? '',
    senderId: 'dashboard',
    senderName: 'Dashboard User',
    sessionId: ws.data.id,
    targetAgentId: parsed.targetAgent,
  };

  debugBus?.emit(
    makeDebugEvent({
      category: DebugEventCategory.WEBSOCKET,
      level: DebugEventLevel.INFO,
      source: 'ws.message',
      message: `Chat message received (${(parsed.content ?? '').length} chars)`,
      data: { targetAgent: parsed.targetAgent },
    }),
  );

  // Persist user message if session tracking is active
  const sessionId = ws.data.sessionId;
  if (sessionStore && sessionId) {
    try {
      sessionStore.addMessage(sessionId, MessageRole.USER, parsed.content ?? '');
    } catch (err) {
      wsLogger.warn('Failed to persist user message', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const onEvent = (event: ConductorEvent) => {
      sendConductorStatus(ws, event);
      debugBus?.emit(conductorEventToDebug(event));
    };

    const agentId = parsed.targetAgent ?? 'conductor';
    let accumulatedContent = '';

    for await (const event of conductor.handleMessageStreaming(incoming, onEvent)) {
      if (event.type === 'chunk') {
        accumulatedContent += event.content ?? '';
        const chunk: WSServerChunk = {
          type: WSServerMessageType.CHUNK,
          content: event.content ?? '',
          agentId,
        };
        ws.send(JSON.stringify(chunk));
      } else if (event.type === 'complete') {
        const complete: WSServerComplete = { type: WSServerMessageType.COMPLETE };
        ws.send(JSON.stringify(complete));
      } else if (event.type === 'error') {
        sendWSError(ws, event.error ?? 'Stream error');
      }
    }

    // Persist assistant message if session tracking is active
    if (sessionStore && sessionId && accumulatedContent) {
      try {
        sessionStore.addMessage(
          sessionId,
          MessageRole.ASSISTANT,
          accumulatedContent,
          parsed.targetAgent,
        );
      } catch (err) {
        wsLogger.warn('Failed to persist assistant message', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    debugBus?.emit(
      makeDebugEvent({
        category: DebugEventCategory.CONDUCTOR,
        level: DebugEventLevel.INFO,
        source: 'conductor.response',
        message: `Response sent (${accumulatedContent.length} chars) via ${agentId}`,
        agentId: parsed.targetAgent,
      }),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    wsLogger.error('Error handling conductor message', { error: msg });
    sendWSError(ws, 'An internal error occurred');
    debugBus?.emit(
      makeDebugEvent({
        category: DebugEventCategory.CONDUCTOR,
        level: DebugEventLevel.ERROR,
        source: 'conductor.error',
        message: `Error handling message: ${msg}`,
      }),
    );
  }
}

function handleParsedMessage(
  ws: ServerWebSocket<WSData>,
  conductor: Conductor,
  parsed: WSClientMessage,
  debugBus?: DebugBus,
  sessionStore?: SessionStore,
): Promise<void> | void {
  if (parsed.type === WSClientMessageType.PING) {
    const pong: WSServerPong = { type: WSServerMessageType.PONG };
    ws.send(JSON.stringify(pong));
    return;
  }

  if (parsed.type === WSClientMessageType.MESSAGE) {
    return handleConductorMessage(ws, conductor, parsed, debugBus, sessionStore);
  }

  sendWSError(ws, 'Unknown message type');
}

export function createWebSocketHandler(
  conductor: Conductor,
  debugBus?: DebugBus,
  sessionStore?: SessionStore,
) {
  const clients = new Set<ServerWebSocket<WSData>>();
  let statusInterval: ReturnType<typeof setInterval> | null = null;

  function broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const ws of clients) {
      try {
        ws.send(data);
      } catch {
        // Client may have disconnected
      }
    }
  }

  function broadcastAgentStatus(): void {
    const agents = conductor.listAgents();
    const msg: WSServerAgentStatus = {
      type: WSServerMessageType.AGENT_STATUS,
      agents,
      conductorName: conductor.conductorName,
    };
    broadcast(msg);

    if (debugBus && debugBus.getSubscriberCount() > 0) {
      debugBus.emit(
        makeDebugEvent({
          category: DebugEventCategory.AGENT,
          level: DebugEventLevel.DEBUG,
          source: 'agent-pool.status',
          message: `Agent status broadcast (${agents.length} agents, ${clients.size} clients)`,
          data: {
            agentCount: agents.length,
            agents: agents.map((a) => ({ id: a.id, name: a.name, status: a.status })),
          },
        }),
      );
    }
  }

  function startStatusBroadcast(): void {
    if (statusInterval) return;
    statusInterval = setInterval(broadcastAgentStatus, 5000);
  }

  function stopStatusBroadcast(): void {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  }

  const handler = {
    open(ws: ServerWebSocket<WSData>): void {
      if (clients.size >= MAX_WS_CLIENTS) {
        sendWSError(ws, 'Too many connections');
        ws.close();
        return;
      }
      clients.add(ws);
      if (clients.size === 1) {
        startStatusBroadcast();
      }

      // Send session_init if this connection has a sessionId
      if (ws.data.sessionId) {
        const sessionInit: WSServerSessionInit = {
          type: WSServerMessageType.SESSION_INIT,
          sessionId: ws.data.sessionId,
        };
        ws.send(JSON.stringify(sessionInit));
      }

      debugBus?.emit(
        makeDebugEvent({
          category: DebugEventCategory.WEBSOCKET,
          level: DebugEventLevel.INFO,
          source: 'ws.connect',
          message: `Chat client connected (${clients.size} total)`,
          data: { clientId: ws.data.id, sessionId: ws.data.sessionId },
        }),
      );
    },

    async message(ws: ServerWebSocket<WSData>, raw: string | Buffer): Promise<void> {
      const text = typeof raw === 'string' ? raw : raw.toString();

      if (text.length > MAX_WS_MESSAGE_SIZE) {
        sendWSError(ws, 'Message too large');
        return;
      }

      // Per-socket message rate limiting
      if (!checkSocketMessageRate(ws.data.id)) {
        sendWSError(ws, 'Message rate limit exceeded');
        ws.close(1008, 'Message rate limit exceeded');
        return;
      }

      let parsed: WSClientMessage;
      try {
        parsed = JSON.parse(text) as WSClientMessage;
      } catch {
        sendWSError(ws, 'Invalid JSON');
        return;
      }

      await handleParsedMessage(ws, conductor, parsed, debugBus, sessionStore);
    },

    close(ws: ServerWebSocket<WSData>): void {
      clients.delete(ws);
      socketMessageCounters.delete(ws.data.id);
      if (clients.size === 0) {
        stopStatusBroadcast();
      }

      debugBus?.emit(
        makeDebugEvent({
          category: DebugEventCategory.WEBSOCKET,
          level: DebugEventLevel.INFO,
          source: 'ws.disconnect',
          message: `Chat client disconnected (${clients.size} remaining)`,
          data: { clientId: ws.data.id },
        }),
      );
    },
  };

  return {
    handler,
    broadcast,
    broadcastAgentStatus,
    getClientCount: () => clients.size,
    shutdown: () => {
      stopStatusBroadcast();
      for (const ws of clients) {
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      }
      clients.clear();
    },
  };
}
