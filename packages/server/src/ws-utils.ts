import type { ServerWebSocket } from 'bun';

/**
 * Safely send a JSON-serialized message over a WebSocket.
 * Silently swallows errors from disconnected clients.
 * Returns true if the send succeeded.
 */
export function safeSend(ws: ServerWebSocket<{ id: string }>, msg: object): boolean {
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely send a pre-serialized string over a WebSocket.
 * Used by broadcast loops where JSON.stringify is done once outside the loop.
 */
export function safeSendRaw(ws: ServerWebSocket<{ id: string }>, data: string): boolean {
  try {
    ws.send(data);
    return true;
  } catch {
    return false;
  }
}
