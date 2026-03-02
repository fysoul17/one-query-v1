import type { BackendRegistry } from '@autonomy/agent-manager';
import type { Conductor, ConductorEvent, IncomingMessage } from '@autonomy/conductor';
import type {
  SessionMessage,
  WSClientMessage,
  WSServerAgentStatus,
  WSServerAgentStep,
  WSServerChunk,
  WSServerComplete,
  WSServerError,
  WSServerPong,
  WSServerSessionInit,
  WSServerStreamResume,
} from '@autonomy/shared';
import {
  DebugEventCategory,
  DebugEventLevel,
  getErrorDetail,
  Logger,
  WSClientMessageType,
  WSServerMessageType,
} from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import type { DebugBus } from './debug-bus.ts';
import { makeDebugEvent } from './debug-bus.ts';
import type { SessionStore } from './session-store.ts';
import {
  accumulateAgentStep,
  buildStepMetadata,
  PHASE_MESSAGES,
  type StepMetadata,
  type StreamState,
} from './step-metadata.ts';
import type { StreamBuffer } from './stream-buffer.ts';
import { SessionStreamBufferManager } from './stream-buffer.ts';
import {
  buildDebugPayload,
  conductorEventToDebug,
  emitResponseDebug,
  sendConductorStatus,
} from './ws-debug.ts';
import { ensureSession, persistAssistantMessage, persistUserMessage } from './ws-session.ts';
import { handleSlashCommand } from './ws-slash-commands.ts';

const MAX_WS_MESSAGE_SIZE = 65_536; // 64 KB
const MAX_WS_CLIENTS = 100;
const WS_MSG_RATE_LIMIT = 10;
const WS_MSG_RATE_WINDOW_MS = 60_000;
const STATUS_BROADCAST_INTERVAL_MS = 5000;

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
  /** Per-session config overrides set via slash commands (e.g., { model: 'sonnet' }). */
  configOverrides?: Record<string, string>;
}

/** Shared context passed through the WebSocket message handling chain. */
interface WebSocketContext {
  conductor: Conductor;
  debugBus?: DebugBus;
  sessionStore?: SessionStore;
  streamTimeoutMs?: number;
  backendRegistry?: BackendRegistry;
  bufferManager?: SessionStreamBufferManager;
  sessionClientsMap?: Map<string, Set<ServerWebSocket<WSData>>>;
  sessionAbortControllers?: Map<string, AbortController>;
}

function sendWSError(ws: ServerWebSocket<WSData>, message: string): void {
  const err: WSServerError = { type: WSServerMessageType.ERROR, message };
  try {
    ws.send(JSON.stringify(err));
  } catch {
    // Client may have disconnected
  }
}

// Debug/status helpers extracted to ws-debug.ts
// Session persistence functions extracted to ws-session.ts

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: WebSocket message handler with multiple event types
async function streamConductorResponse(
  ws: ServerWebSocket<WSData>,
  ctx: WebSocketContext,
  incoming: IncomingMessage,
  agentId: string,
  targetAgent: string | undefined,
  buffer?: StreamBuffer,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<{ content: string; stepMetadata?: StepMetadata }> {
  const { conductor, debugBus, streamTimeoutMs, sessionClientsMap } = ctx;

  // Resolve agent display name once before the streaming loop so step events can carry it.
  // Falls back to undefined for 'conductor' (which has no pool entry).
  const agentDisplayName = conductor.listAgents().find((a) => a.id === agentId)?.name;

  // conductor_status events go directly to the requesting ws (not buffered)
  // Also accumulate pipeline phases for persistence.
  const onEvent = (event: ConductorEvent) => {
    sendConductorStatus(ws, event);
    debugBus?.emit(conductorEventToDebug(event));

    // Accumulate pipeline phase for metadata persistence.
    state.pipelinePhases.push({
      phase: event.type,
      message: event.content ?? PHASE_MESSAGES[event.type] ?? event.type,
      timestamp: Date.now(),
      durationMs: event.durationMs,
      debug: buildDebugPayload(event),
    });
  };

  const state: StreamState = {
    accumulatedContent: '',
    completeSent: false,
    errorSent: false,
    pipelinePhases: [],
    agentActivities: new Map(),
    toolToAgent: new Map(),
  };

  /**
   * Broadcast a message to all current session clients (if buffer exists) or just the requesting ws.
   * Looks up the current client set on each call so reconnecting clients are included automatically.
   * When buffer exists, the message is also appended to the buffer for replay on reconnect.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: WebSocket message handler with multiple event types
  function broadcastMsg(msg: object): void {
    const data = JSON.stringify(msg);
    if (buffer && sessionId && sessionClientsMap) {
      buffer.append(msg);
      const sessionClients = sessionClientsMap.get(sessionId);
      if (sessionClients) {
        for (const client of sessionClients) {
          try {
            client.send(data);
          } catch {
            // Client disconnected — buffer keeps accumulating
          }
        }
      }
    } else {
      try {
        ws.send(data);
      } catch {
        // Client disconnected
      }
    }
  }

  const timeout = streamTimeoutMs ?? 300_000;
  const timeoutId = setTimeout(() => {
    if (!state.completeSent && !state.errorSent) {
      state.errorSent = true;
      if (buffer) buffer.markError();
      const errMsg: WSServerError = {
        type: WSServerMessageType.ERROR,
        message: `Response timed out after ${Math.round(timeout / 1000)}s`,
      };
      broadcastMsg(errMsg);
      debugBus?.emit(
        makeDebugEvent({
          category: DebugEventCategory.CONDUCTOR,
          level: DebugEventLevel.WARN,
          source: 'conductor.stream_timeout',
          message: `Stream timed out after ${timeout}ms for ${agentId}`,
          agentId: targetAgent,
        }),
      );
    }
  }, timeout);

  try {
    for await (const event of conductor.handleMessageStreaming(incoming, onEvent, signal)) {
      if (state.errorSent || state.completeSent) break;
      if (signal?.aborted) break;

      if (event.type === 'chunk') {
        const content = event.content ?? '';
        state.accumulatedContent += content;
        const chunk: WSServerChunk = {
          type: WSServerMessageType.CHUNK,
          content,
          agentId,
        };
        broadcastMsg(chunk);
      } else if (event.type === 'complete') {
        state.completeSent = true;
        if (buffer) buffer.markComplete();
        const complete: WSServerComplete = { type: WSServerMessageType.COMPLETE };
        broadcastMsg(complete);
      } else if (
        event.type === 'tool_start' ||
        event.type === 'tool_input' ||
        event.type === 'tool_complete' ||
        event.type === 'thinking'
      ) {
        // Accumulate agent step data for metadata persistence
        accumulateAgentStep(state, event, agentId, agentDisplayName);

        // Agent-level step events: broadcast to live clients but do NOT accumulate
        // in the stream buffer (buffer only tracks chunk content for reconnect replay).
        const step: WSServerAgentStep = {
          type: WSServerMessageType.AGENT_STEP,
          stepType: event.type,
          agentId,
          agentName: agentDisplayName,
          toolId: event.toolId,
          toolName: event.toolName,
          inputDelta: event.inputDelta,
          content: event.content,
          durationMs: event.durationMs,
          timestamp: new Date().toISOString(),
        };
        broadcastMsg(step);

        // Emit to debug bus so tool events appear in the debug console in real-time.
        if (debugBus) {
          let dbgMessage: string;
          let dbgLevel: DebugEventLevel = DebugEventLevel.DEBUG;
          if (event.type === 'tool_start') {
            dbgMessage = `→ ${event.toolName ?? 'tool'}`;
            dbgLevel = DebugEventLevel.INFO;
          } else if (event.type === 'tool_complete') {
            dbgMessage = `✓ ${event.toolName ?? 'tool'} (${event.durationMs ?? 0}ms)`;
            dbgLevel = DebugEventLevel.INFO;
          } else if (event.type === 'thinking') {
            dbgMessage = 'thinking…';
          } else {
            // tool_input — skip to avoid flooding the debug console with large JSON deltas
            dbgMessage = '';
          }
          if (dbgMessage) {
            debugBus.emit(
              makeDebugEvent({
                category: DebugEventCategory.AGENT,
                level: dbgLevel,
                source: `agent.${event.type}`,
                message: dbgMessage,
                agentId: targetAgent ?? agentId,
                durationMs: event.durationMs,
                data: {
                  ...(event.toolId && { toolId: event.toolId }),
                  ...(event.toolName && { toolName: event.toolName }),
                },
              }),
            );
          }
        }
      } else if (event.type === 'error') {
        if (state.accumulatedContent.length > 0) {
          // Content was already streamed — complete normally.
          state.completeSent = true;
          if (buffer) buffer.markComplete();
          wsLogger.warn('Stream error after content delivery — completing normally', {
            agentId,
            error: event.error,
          });
          broadcastMsg({ type: WSServerMessageType.COMPLETE });
        } else {
          state.errorSent = true;
          if (buffer) buffer.markError();
          wsLogger.warn('Stream error from backend', { agentId, error: event.error });
          debugBus?.emit(
            makeDebugEvent({
              category: DebugEventCategory.CONDUCTOR,
              level: DebugEventLevel.ERROR,
              source: 'conductor.stream_error',
              message: `Stream error from ${agentId}: ${event.error ?? 'Unknown error'}`,
              agentId: targetAgent,
            }),
          );
          const errMsg: WSServerError = {
            type: WSServerMessageType.ERROR,
            message: 'An error occurred while generating the response.',
          };
          broadcastMsg(errMsg);
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);

    if (!state.completeSent && !state.errorSent) {
      if (state.accumulatedContent.length > 0) {
        if (buffer) buffer.markComplete();
        broadcastMsg({ type: WSServerMessageType.COMPLETE });
      } else {
        if (buffer) buffer.markError();
        const errMsg: WSServerError = {
          type: WSServerMessageType.ERROR,
          message: 'No response was generated. The AI backend may be unavailable.',
        };
        broadcastMsg(errMsg);
      }
    }
  }

  return { content: state.accumulatedContent, stepMetadata: buildStepMetadata(state) };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming handler with abort and error handling
async function handleConductorMessage(
  ws: ServerWebSocket<WSData>,
  ctx: WebSocketContext,
  parsed: WSClientMessage,
): Promise<void> {
  const { debugBus, sessionStore, bufferManager, sessionClientsMap, sessionAbortControllers } = ctx;
  ensureSession(ws, sessionStore);

  // After ensureSession, ws.data.sessionId may have just been set (lazy session creation).
  // Register this ws in sessionClientsMap so broadcastMsg can deliver live chunks to it.
  if (ws.data.sessionId && sessionClientsMap) {
    let clientSet = sessionClientsMap.get(ws.data.sessionId);
    if (!clientSet) {
      clientSet = new Set();
      sessionClientsMap.set(ws.data.sessionId, clientSet);
    }
    clientSet.add(ws);
  }

  // Fetch conversation history before persisting the current message so we get only prior turns.
  const MAX_HISTORY_MESSAGES = 20;
  let conversationHistory: SessionMessage[] | undefined;
  const sessionId = ws.data.sessionId;
  if (sessionStore && sessionId) {
    try {
      const messages = sessionStore.getRecentMessages(sessionId, MAX_HISTORY_MESSAGES);
      if (messages.length > 0) {
        conversationHistory = messages;
      }
    } catch (err) {
      wsLogger.warn('Failed to fetch conversation history', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Look up stored native backend session ID for --resume across restarts.
  let backendSessionId: string | undefined;
  if (sessionStore && sessionId) {
    try {
      backendSessionId = sessionStore.getBackendSessionId(sessionId);
    } catch {
      // Non-critical — process will start fresh without resume
    }
  }

  const metadata: Record<string, unknown> = {};
  if (ws.data.configOverrides) {
    metadata.configOverrides = { ...ws.data.configOverrides };
  }
  if (backendSessionId) {
    metadata.backendSessionId = backendSessionId;
  }

  const incoming: IncomingMessage = {
    content: parsed.content ?? '',
    senderId: 'dashboard',
    senderName: 'Dashboard User',
    sessionId: ws.data.sessionId,
    targetAgentId: parsed.targetAgent,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    conversationHistory,
  };

  debugBus?.emit(
    makeDebugEvent({
      category: DebugEventCategory.WEBSOCKET,
      level: DebugEventLevel.INFO,
      source: 'ws.message',
      message: `Chat message received (${(parsed.content ?? '').length} chars)`,
      data: {
        targetAgent: parsed.targetAgent,
        historyTurnCount: conversationHistory?.length ?? 0,
      },
    }),
  );

  if (sessionStore && sessionId) {
    persistUserMessage(sessionStore, sessionId, parsed.content ?? '');
  }

  const agentId = parsed.targetAgent ?? 'conductor';

  // Set up per-session stream buffer so output survives WS disconnects
  let buffer: StreamBuffer | undefined;
  if (sessionId && bufferManager) {
    const existing = bufferManager.get(sessionId);
    if (existing?.status === 'streaming') {
      existing.markAbandoned();
    }
    // Always remove the old buffer so each new message gets a fresh one
    bufferManager.remove(sessionId);
    buffer = bufferManager.getOrCreate(sessionId, agentId);
  }

  // Create an AbortController for this stream so it can be cancelled via cancel message
  let abortController: AbortController | undefined;
  if (sessionId && sessionAbortControllers) {
    // Abort any previous stream for this session
    const prev = sessionAbortControllers.get(sessionId);
    if (prev) prev.abort();
    abortController = new AbortController();
    sessionAbortControllers.set(sessionId, abortController);
  }

  try {
    const result = await streamConductorResponse(
      ws,
      ctx,
      incoming,
      agentId,
      parsed.targetAgent,
      buffer,
      sessionId,
      abortController?.signal,
    );

    if (sessionStore && sessionId && result.content) {
      persistAssistantMessage(
        sessionStore,
        sessionId,
        result.content,
        parsed.targetAgent,
        result.stepMetadata as Record<string, unknown> | undefined,
      );

      // Persist the native backend session ID so --resume works after restart.
      try {
        const newBackendSessionId = conductor.getSessionBackendId(sessionId);
        if (newBackendSessionId && newBackendSessionId !== backendSessionId) {
          sessionStore.setBackendSessionId(sessionId, newBackendSessionId);
        }
      } catch {
        // Non-critical — session will start fresh on next restart
      }
    }

    emitResponseDebug(debugBus, agentId, parsed.targetAgent, result.content.length);
  } catch (error) {
    const msg = getErrorDetail(error);
    wsLogger.error('Error handling conductor message', { error: msg });
    if (buffer) buffer.markError();
    sendWSError(ws, 'An internal error occurred');
    debugBus?.emit(
      makeDebugEvent({
        category: DebugEventCategory.CONDUCTOR,
        level: DebugEventLevel.ERROR,
        source: 'conductor.error',
        message: `Error handling message: ${msg}`,
      }),
    );
  } finally {
    // Clean up the abort controller for this session
    if (sessionId && sessionAbortControllers && abortController) {
      // Only delete if it's still the same controller (not replaced by a new message)
      if (sessionAbortControllers.get(sessionId) === abortController) {
        sessionAbortControllers.delete(sessionId);
      }
    }
  }
}

// Slash command handling extracted to ws-slash-commands.ts

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: delegation handler with streaming support
function handleParsedMessage(
  ws: ServerWebSocket<WSData>,
  ctx: WebSocketContext,
  parsed: WSClientMessage,
): Promise<void> | void {
  const { conductor, debugBus, backendRegistry, bufferManager, sessionAbortControllers } = ctx;
  if (parsed.type === WSClientMessageType.PING) {
    const pong: WSServerPong = { type: WSServerMessageType.PONG };
    try {
      ws.send(JSON.stringify(pong));
    } catch {
      // Client may have disconnected
    }
    return;
  }

  if (parsed.type === WSClientMessageType.CANCEL) {
    const sessionId = ws.data.sessionId;
    if (sessionId && sessionAbortControllers) {
      const controller = sessionAbortControllers.get(sessionId);
      if (controller) {
        controller.abort();
        sessionAbortControllers.delete(sessionId);
        wsLogger.info('Stream cancelled by client', { sessionId });
        debugBus?.emit(
          makeDebugEvent({
            category: DebugEventCategory.WEBSOCKET,
            level: DebugEventLevel.INFO,
            source: 'ws.cancel',
            message: 'Stream cancelled by client',
            data: { sessionId },
          }),
        );
      }
      // Mark the stream buffer as error so reconnecting clients don't replay
      if (bufferManager) {
        const buffer = bufferManager.get(sessionId);
        if (buffer && buffer.status === 'streaming') {
          buffer.markError();
        }
      }
    }
    return;
  }

  if (parsed.type === WSClientMessageType.MESSAGE) {
    // Intercept slash commands before dispatching to conductor
    const content = parsed.content ?? '';
    if (
      content.trim().startsWith('/') &&
      handleSlashCommand(ws, content, backendRegistry, conductor)
    ) {
      return;
    }

    return handleConductorMessage(ws, ctx, parsed);
  }

  sendWSError(ws, 'Unknown message type');
}

export function createWebSocketHandler(
  conductor: Conductor,
  debugBus?: DebugBus,
  sessionStore?: SessionStore,
  streamTimeoutMs?: number,
  backendRegistry?: BackendRegistry,
) {
  const clients = new Set<ServerWebSocket<WSData>>();
  let statusInterval: ReturnType<typeof setInterval> | null = null;

  /** Per-session buffer: decouples streaming output from WebSocket lifetime. */
  const bufferManager = new SessionStreamBufferManager();

  /** Maps sessionId → set of active WebSocket connections for that session. */
  const sessionClientsMap = new Map<string, Set<ServerWebSocket<WSData>>>();

  /** Per-session AbortController for cancelling active streams. */
  const sessionAbortControllers = new Map<string, AbortController>();

  const wsCtx: WebSocketContext = {
    conductor,
    debugBus,
    sessionStore,
    streamTimeoutMs,
    backendRegistry,
    bufferManager,
    sessionClientsMap,
    sessionAbortControllers,
  };

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
    statusInterval = setInterval(broadcastAgentStatus, STATUS_BROADCAST_INTERVAL_MS);
  }

  function stopStatusBroadcast(): void {
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }
  }

  const handler = {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: WebSocket message dispatch with multiple message types
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

      // Track this connection in the session client map
      if (ws.data.sessionId) {
        let clientSet = sessionClientsMap.get(ws.data.sessionId);
        if (!clientSet) {
          clientSet = new Set();
          sessionClientsMap.set(ws.data.sessionId, clientSet);
        }
        clientSet.add(ws);
      }

      // Send session_init if this connection has a sessionId
      if (ws.data.sessionId) {
        const sessionInit: WSServerSessionInit = {
          type: WSServerMessageType.SESSION_INIT,
          sessionId: ws.data.sessionId,
        };
        try {
          ws.send(JSON.stringify(sessionInit));
        } catch {
          // Client may have disconnected
        }

        // Replay buffered content for reconnecting clients
        const buffer = bufferManager.get(ws.data.sessionId);
        if (buffer && (buffer.accumulatedContent.length > 0 || buffer.status === 'streaming')) {
          const resume: WSServerStreamResume = {
            type: WSServerMessageType.STREAM_RESUME,
            content: buffer.accumulatedContent,
            agentId: buffer.agentId,
            streaming: buffer.status === 'streaming',
          };
          try {
            ws.send(JSON.stringify(resume));
          } catch {
            // Client may have disconnected
          }
        }
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

      await handleParsedMessage(ws, wsCtx, parsed);
    },

    close(ws: ServerWebSocket<WSData>): void {
      clients.delete(ws);
      socketMessageCounters.delete(ws.data.id);

      // Remove from session client tracking
      if (ws.data.sessionId) {
        const clientSet = sessionClientsMap.get(ws.data.sessionId);
        if (clientSet) {
          clientSet.delete(ws);
          if (clientSet.size === 0) {
            sessionClientsMap.delete(ws.data.sessionId);
          }
        }
      }

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
    bufferManager,
    shutdown: () => {
      stopStatusBroadcast();
      bufferManager.shutdown();
      // Abort all active streams
      for (const controller of sessionAbortControllers.values()) {
        controller.abort();
      }
      sessionAbortControllers.clear();
      for (const ws of clients) {
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      }
      clients.clear();
      sessionClientsMap.clear();
    },
  };
}
