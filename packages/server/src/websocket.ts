import type { Conductor, IncomingMessage } from '@autonomy/conductor';
import type {
  WSClientMessage,
  WSServerAgentStatus,
  WSServerChunk,
  WSServerComplete,
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

export function createWebSocketHandler(conductor: Conductor) {
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
        const err: WSServerError = {
          type: WSServerMessageType.ERROR,
          message: 'Too many connections',
        };
        ws.send(JSON.stringify(err));
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
        const err: WSServerError = {
          type: WSServerMessageType.ERROR,
          message: 'Message too large',
        };
        ws.send(JSON.stringify(err));
        return;
      }

      let parsed: WSClientMessage;
      try {
        parsed = JSON.parse(text) as WSClientMessage;
      } catch {
        const err: WSServerError = {
          type: WSServerMessageType.ERROR,
          message: 'Invalid JSON',
        };
        ws.send(JSON.stringify(err));
        return;
      }

      if (parsed.type === WSClientMessageType.PING) {
        const pong: WSServerPong = { type: WSServerMessageType.PONG };
        ws.send(JSON.stringify(pong));
        return;
      }

      if (parsed.type === WSClientMessageType.MESSAGE) {
        const incoming: IncomingMessage = {
          content: parsed.content ?? '',
          senderId: 'dashboard',
          senderName: 'Dashboard User',
          targetAgentId: parsed.targetAgent,
        };

        try {
          const response = await conductor.handleMessage(incoming);

          const chunk: WSServerChunk = {
            type: WSServerMessageType.CHUNK,
            content: response.content,
            agentId: response.agentId ?? 'conductor',
          };
          ws.send(JSON.stringify(chunk));

          const complete: WSServerComplete = {
            type: WSServerMessageType.COMPLETE,
          };
          ws.send(JSON.stringify(complete));
        } catch (error) {
          const errMsg: WSServerError = {
            type: WSServerMessageType.ERROR,
            message: error instanceof Error ? error.message : String(error),
          };
          ws.send(JSON.stringify(errMsg));
        }
        return;
      }

      const err: WSServerError = {
        type: WSServerMessageType.ERROR,
        message: `Unknown message type: ${(parsed as { type?: string }).type}`,
      };
      ws.send(JSON.stringify(err));
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
