import type { BackendRegistry } from '@autonomy/agent-manager';
import type { Conductor, ConductorEvent, IncomingMessage } from '@autonomy/conductor';
import { ConductorEventType } from '@autonomy/conductor';
import type {
  BackendConfigOption,
  ConductorDebugPayload,
  DebugEvent,
  SessionMessage,
  WSClientMessage,
  WSServerAgentStatus,
  WSServerAgentStep,
  WSServerChunk,
  WSServerComplete,
  WSServerConductorStatus,
  WSServerError,
  WSServerPong,
  WSServerSessionInit,
  WSServerStreamResume,
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
import type { StreamBuffer } from './stream-buffer.ts';
import { SessionStreamBufferManager } from './stream-buffer.ts';

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
  /** Per-session config overrides set via slash commands (e.g., { model: 'sonnet' }). */
  configOverrides?: Record<string, string>;
}

function sendWSError(ws: ServerWebSocket<WSData>, message: string): void {
  const err: WSServerError = { type: WSServerMessageType.ERROR, message };
  try {
    ws.send(JSON.stringify(err));
  } catch {
    // Client may have disconnected
  }
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
  // routerType is not currently emitted by ConductorEvent; field intentionally omitted
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
  if (event.historyTurnCount !== undefined) {
    debug.historyTurnCount = event.historyTurnCount;
    hasData = true;
  }
  if (event.historyChars !== undefined) {
    debug.historyChars = event.historyChars;
    hasData = true;
  }

  return hasData ? debug : undefined;
}

function conductorEventToDebug(event: ConductorEvent): DebugEvent {
  const phaseMap: Record<string, string> = {
    [ConductorEventType.QUEUED]: 'Message queued',
    [ConductorEventType.DELEGATING]: 'Delegating to agent',
    [ConductorEventType.MEMORY_SEARCH]: 'Searching memory',
    [ConductorEventType.CONTEXT_INJECT]: 'Injecting conversation history',
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
      // routerType not present on ConductorEvent
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
    case ConductorEventType.CONTEXT_INJECT:
      phase = 'context_inject';
      message = event.content ?? 'Loading conversation history...';
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
  try {
    ws.send(JSON.stringify(status));
  } catch {
    // Client may have disconnected
  }
}

function ensureSession(ws: ServerWebSocket<WSData>, sessionStore?: SessionStore): void {
  if (!ws.data.sessionId && sessionStore) {
    const session = sessionStore.create({ title: 'New Chat' });
    ws.data.sessionId = session.id;
    const sessionInit: WSServerSessionInit = {
      type: WSServerMessageType.SESSION_INIT,
      sessionId: session.id,
    };
    try {
      ws.send(JSON.stringify(sessionInit));
    } catch {
      // Client may have disconnected
    }
  }
}

function persistUserMessage(sessionStore: SessionStore, sessionId: string, content: string): void {
  try {
    sessionStore.addMessage(sessionId, MessageRole.USER, content);
    const session = sessionStore.getById(sessionId);
    if (session && session.title === 'New Chat' && session.messageCount <= 1 && content) {
      const title = content.length > 60 ? `${content.slice(0, 57)}...` : content;
      sessionStore.update(sessionId, { title });
    }
  } catch (err) {
    wsLogger.warn('Failed to persist user message', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function persistAssistantMessage(
  sessionStore: SessionStore,
  sessionId: string,
  content: string,
  targetAgent?: string,
): void {
  try {
    sessionStore.addMessage(sessionId, MessageRole.ASSISTANT, content, targetAgent);
  } catch (err) {
    wsLogger.warn('Failed to persist assistant message', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function emitResponseDebug(
  debugBus: DebugBus | undefined,
  agentId: string,
  targetAgent: string | undefined,
  contentLength: number,
): void {
  const isEmpty = contentLength === 0;
  debugBus?.emit(
    makeDebugEvent({
      category: DebugEventCategory.CONDUCTOR,
      level: isEmpty ? DebugEventLevel.WARN : DebugEventLevel.INFO,
      source: isEmpty ? 'conductor.empty_response' : 'conductor.response',
      message: isEmpty
        ? `Empty response from ${agentId} — possible backend failure`
        : `Response sent (${contentLength} chars) via ${agentId}`,
      agentId: targetAgent,
    }),
  );
}

interface StreamState {
  accumulatedContent: string;
  completeSent: boolean;
  errorSent: boolean;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: WebSocket message handler with multiple event types
async function streamConductorResponse(
  ws: ServerWebSocket<WSData>,
  conductor: Conductor,
  incoming: IncomingMessage,
  agentId: string,
  targetAgent: string | undefined,
  debugBus?: DebugBus,
  streamTimeoutMs?: number,
  buffer?: StreamBuffer,
  sessionId?: string,
  sessionClientsMap?: Map<string, Set<ServerWebSocket<WSData>>>,
  signal?: AbortSignal,
): Promise<{ content: string }> {
  // Resolve agent display name once before the streaming loop so step events can carry it.
  // Falls back to undefined for 'conductor' (which has no pool entry).
  const agentDisplayName = conductor.listAgents().find((a) => a.id === agentId)?.name;

  // conductor_status events go directly to the requesting ws (not buffered)
  const onEvent = (event: ConductorEvent) => {
    sendConductorStatus(ws, event);
    debugBus?.emit(conductorEventToDebug(event));
  };

  const state: StreamState = { accumulatedContent: '', completeSent: false, errorSent: false };

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

  return { content: state.accumulatedContent };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming handler with abort and error handling
async function handleConductorMessage(
  ws: ServerWebSocket<WSData>,
  conductor: Conductor,
  parsed: WSClientMessage,
  debugBus?: DebugBus,
  sessionStore?: SessionStore,
  streamTimeoutMs?: number,
  bufferManager?: SessionStreamBufferManager,
  sessionClientsMap?: Map<string, Set<ServerWebSocket<WSData>>>,
  sessionAbortControllers?: Map<string, AbortController>,
): Promise<void> {
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
      const detail = sessionStore.getDetail(sessionId);
      if (detail?.messages && detail.messages.length > 0) {
        // Slice to the last MAX_HISTORY_MESSAGES entries (chronological order, oldest first).
        conversationHistory = detail.messages.slice(-MAX_HISTORY_MESSAGES);
      }
    } catch (err) {
      wsLogger.warn('Failed to fetch conversation history', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const incoming: IncomingMessage = {
    content: parsed.content ?? '',
    senderId: 'dashboard',
    senderName: 'Dashboard User',
    sessionId: ws.data.sessionId,
    targetAgentId: parsed.targetAgent,
    metadata: ws.data.configOverrides
      ? { configOverrides: { ...ws.data.configOverrides } }
      : undefined,
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
      conductor,
      incoming,
      agentId,
      parsed.targetAgent,
      debugBus,
      streamTimeoutMs,
      buffer,
      sessionId,
      sessionClientsMap,
      abortController?.signal,
    );

    if (sessionStore && sessionId && result.content) {
      persistAssistantMessage(sessionStore, sessionId, result.content, parsed.targetAgent);
    }

    emitResponseDebug(debugBus, agentId, parsed.targetAgent, result.content.length);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
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

/** Send a system message back to the client using the CHUNK + COMPLETE pattern. */
function sendSystemMessage(ws: ServerWebSocket<WSData>, content: string): void {
  const chunk: WSServerChunk = {
    type: WSServerMessageType.CHUNK,
    content,
    agentId: 'system',
  };
  try {
    ws.send(JSON.stringify(chunk));
    ws.send(JSON.stringify({ type: WSServerMessageType.COMPLETE }));
  } catch {
    // Client may have disconnected
  }
}

/**
 * Handle slash commands (e.g., /model, /help, /config).
 * Returns true if the message was handled as a slash command.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: agent step handler with many event types
function handleSlashCommand(
  ws: ServerWebSocket<WSData>,
  content: string,
  backendRegistry?: BackendRegistry,
  conductor?: Conductor,
): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return false;

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const value = parts.slice(1).join(' ').trim();

  if (!command) return false;

  const configOptions: BackendConfigOption[] = backendRegistry
    ? backendRegistry.getDefault().getConfigOptions()
    : [];

  if (command === 'help') {
    if (configOptions.length === 0) {
      sendSystemMessage(ws, 'No configurable options available for the current backend.');
      return true;
    }
    const lines = ['**Available commands:**', ''];
    for (const opt of configOptions) {
      const valuesStr = opt.values ? ` (${opt.values.join(', ')})` : '';
      const defaultStr = opt.defaultValue ? ` [default: ${opt.defaultValue}]` : '';
      lines.push(`- \`/${opt.name} <value>\` — ${opt.description}${valuesStr}${defaultStr}`);
    }
    lines.push('', '- `/config` — Show current session overrides');
    lines.push('- `/help` — Show this help message');
    sendSystemMessage(ws, lines.join('\n'));
    return true;
  }

  if (command === 'config') {
    const overrides = ws.data.configOverrides;
    if (!overrides || Object.keys(overrides).length === 0) {
      sendSystemMessage(ws, 'No config overrides set for this session. Using defaults.');
      return true;
    }
    const lines = ['**Current session overrides:**', ''];
    for (const [key, val] of Object.entries(overrides)) {
      lines.push(`- **${key}**: ${val}`);
    }
    sendSystemMessage(ws, lines.join('\n'));
    return true;
  }

  // Check if command matches a config option
  const option = configOptions.find((opt) => opt.name === command);
  if (!option) {
    sendSystemMessage(
      ws,
      `Unknown command \`/${command}\`. Type \`/help\` for available commands.`,
    );
    return true;
  }

  // Show current value if no argument given
  if (!value) {
    const current = ws.data.configOverrides?.[option.name] ?? option.defaultValue ?? 'not set';
    const valuesStr = option.values ? `\nValid values: ${option.values.join(', ')}` : '';
    sendSystemMessage(ws, `**${option.name}**: ${current}${valuesStr}`);
    return true;
  }

  // Defense-in-depth: reject values with control characters or excessive length before any
  // validation or persistence, even if all current options have enumerable values arrays.
  const MAX_OPTION_VALUE_LENGTH = 256;
  if (value.length > MAX_OPTION_VALUE_LENGTH) {
    sendSystemMessage(
      ws,
      `Value for **${option.name}** is too long (max ${MAX_OPTION_VALUE_LENGTH} characters).`,
    );
    return true;
  }
  if (/[\n\r\t\0]/.test(value)) {
    sendSystemMessage(
      ws,
      `Invalid value for **${option.name}**: control characters are not allowed.`,
    );
    return true;
  }

  // Validate value against known values (if enumerable)
  if (option.values && !option.values.includes(value)) {
    sendSystemMessage(
      ws,
      `Invalid value \`${value}\` for **${option.name}**. Valid values: ${option.values.join(', ')}`,
    );
    return true;
  }

  // Store the override
  if (!ws.data.configOverrides) {
    ws.data.configOverrides = {};
  }
  ws.data.configOverrides[option.name] = value;

  // Invalidate existing session backend so next message spawns with new flags
  if (conductor && ws.data.sessionId) {
    conductor.invalidateSessionBackend(ws.data.sessionId);
  }

  // COUPLING: This message format is parsed by CONFIG_CONFIRM_RE in
  // dashboard/app/components/chat/chat-interface.tsx. If this format changes,
  // the regex in the client must be updated to match.
  sendSystemMessage(ws, `**${option.name}** set to **${value}** for this session.`);
  return true;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: delegation handler with streaming support
function handleParsedMessage(
  ws: ServerWebSocket<WSData>,
  conductor: Conductor,
  parsed: WSClientMessage,
  debugBus?: DebugBus,
  sessionStore?: SessionStore,
  streamTimeoutMs?: number,
  backendRegistry?: BackendRegistry,
  bufferManager?: SessionStreamBufferManager,
  sessionClientsMap?: Map<string, Set<ServerWebSocket<WSData>>>,
  sessionAbortControllers?: Map<string, AbortController>,
): Promise<void> | void {
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

    return handleConductorMessage(
      ws,
      conductor,
      parsed,
      debugBus,
      sessionStore,
      streamTimeoutMs,
      bufferManager,
      sessionClientsMap,
      sessionAbortControllers,
    );
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

      await handleParsedMessage(
        ws,
        conductor,
        parsed,
        debugBus,
        sessionStore,
        streamTimeoutMs,
        backendRegistry,
        bufferManager,
        sessionClientsMap,
        sessionAbortControllers,
      );
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
