import type { Conductor, ConductorEvent, IncomingMessage } from '@autonomy/conductor';
import { ConductorEventType } from '@autonomy/conductor';
import type {
  ConductorDebugPayload,
  WSClientMessage,
  WSServerAgentStatus,
  WSServerChunk,
  WSServerComplete,
  WSServerConductorStatus,
  WSServerError,
  WSServerPong,
} from '@autonomy/shared';
import { WSClientMessageType, WSServerMessageType } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';

const MAX_WS_MESSAGE_SIZE = 65_536; // 64 KB
const MAX_WS_CLIENTS = 100;

export interface WSData {
  id: string;
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

  return hasData ? debug : undefined;
}

function sendConductorStatus(
  ws: ServerWebSocket<WSData>,
  event: ConductorEvent,
  debugEnabled = false,
): void {
  let phase: WSServerConductorStatus['phase'];
  let message: string;

  switch (event.type) {
    case ConductorEventType.ROUTING:
      phase = 'analyzing';
      message = event.content ?? 'Analyzing your request...';
      break;
    case ConductorEventType.CREATING_AGENT:
      phase = 'creating_agent';
      message = event.agentName
        ? `Creating specialist agent "${event.agentName}"...`
        : 'Creating a new agent...';
      break;
    case ConductorEventType.AGENT_CREATED:
      phase = 'creating_agent';
      message = event.agentName ? `Agent "${event.agentName}" created` : 'Agent created';
      break;
    case ConductorEventType.DELEGATING:
      phase = 'delegating';
      message = 'Delegating to agent...';
      break;
    case ConductorEventType.MEMORY_SEARCH:
      phase = 'memory_search';
      message = event.content ?? 'Searching memory...';
      break;
    case ConductorEventType.ROUTING_COMPLETE:
      phase = 'routing_complete';
      message = event.content ?? 'Routing complete';
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
    debug: debugEnabled ? buildDebugPayload(event) : undefined,
  };
  ws.send(JSON.stringify(status));
}

async function handleConductorMessage(
  ws: ServerWebSocket<WSData>,
  conductor: Conductor,
  parsed: WSClientMessage,
  debugEnabled: boolean,
): Promise<void> {
  const incoming: IncomingMessage = {
    content: parsed.content ?? '',
    senderId: 'dashboard',
    senderName: 'Dashboard User',
    targetAgentId: parsed.targetAgent,
  };

  try {
    const onEvent = (event: ConductorEvent) => sendConductorStatus(ws, event, debugEnabled);
    const response = await conductor.handleMessage(incoming, onEvent);
    const chunk: WSServerChunk = {
      type: WSServerMessageType.CHUNK,
      content: response.content,
      agentId: response.agentId ?? 'conductor',
    };
    ws.send(JSON.stringify(chunk));

    const complete: WSServerComplete = { type: WSServerMessageType.COMPLETE };
    ws.send(JSON.stringify(complete));
  } catch (error) {
    sendWSError(ws, error instanceof Error ? error.message : String(error));
  }
}

function handleParsedMessage(
  ws: ServerWebSocket<WSData>,
  conductor: Conductor,
  parsed: WSClientMessage,
  debugEnabled: boolean,
): Promise<void> | void {
  if (parsed.type === WSClientMessageType.PING) {
    const pong: WSServerPong = { type: WSServerMessageType.PONG };
    ws.send(JSON.stringify(pong));
    return;
  }

  if (parsed.type === WSClientMessageType.MESSAGE) {
    return handleConductorMessage(ws, conductor, parsed, debugEnabled);
  }

  sendWSError(ws, `Unknown message type: ${(parsed as { type?: string }).type}`);
}

export interface WebSocketHandlerOptions {
  debugEnabled?: boolean;
}

export function createWebSocketHandler(conductor: Conductor, options?: WebSocketHandlerOptions) {
  const debugEnabled = options?.debugEnabled ?? false;
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
    };
    broadcast(msg);
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
    },

    async message(ws: ServerWebSocket<WSData>, raw: string | Buffer): Promise<void> {
      const text = typeof raw === 'string' ? raw : raw.toString();

      if (text.length > MAX_WS_MESSAGE_SIZE) {
        sendWSError(ws, 'Message too large');
        return;
      }

      let parsed: WSClientMessage;
      try {
        parsed = JSON.parse(text) as WSClientMessage;
      } catch {
        sendWSError(ws, 'Invalid JSON');
        return;
      }

      await handleParsedMessage(ws, conductor, parsed, debugEnabled);
    },

    close(ws: ServerWebSocket<WSData>): void {
      clients.delete(ws);
      if (clients.size === 0) {
        stopStatusBroadcast();
      }
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
