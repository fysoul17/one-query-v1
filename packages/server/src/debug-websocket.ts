import type {
  DebugEventCategory,
  DebugEventLevel,
  WSClientDebugSubscribe,
  WSServerDebugEvent,
  WSServerDebugHistory,
} from '@autonomy/shared';
import {
  DebugEventCategory as Categories,
  DEBUG_LEVEL_ORDER,
  DebugEventLevel as Levels,
  WSServerMessageType,
} from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import type { DebugBus, DebugEventCallback } from './debug-bus.ts';
import { safeSend } from './ws-utils.ts';

const MAX_DEBUG_CLIENTS = 20;
const MAX_DEBUG_MESSAGE_SIZE = 4096;

const VALID_CATEGORIES = new Set<string>(Object.values(Categories));
const VALID_LEVELS = new Set<string>(Object.values(Levels));

export interface DebugWSData {
  id: string;
  type: 'debug';
  filter?: {
    categories?: DebugEventCategory[];
    minLevel?: DebugEventLevel;
  };
}

function matchesFilter(
  event: { category: DebugEventCategory; level: DebugEventLevel },
  filter?: DebugWSData['filter'],
): boolean {
  if (!filter) return true;
  if (filter.categories?.length) {
    if (!filter.categories.includes(event.category)) return false;
  }
  if (filter.minLevel) {
    if (DEBUG_LEVEL_ORDER[event.level] < DEBUG_LEVEL_ORDER[filter.minLevel]) return false;
  }
  return true;
}

function validateFilter(raw: WSClientDebugSubscribe['filter']): DebugWSData['filter'] {
  if (!raw) return undefined;
  const result: DebugWSData['filter'] = {};
  if (Array.isArray(raw.categories)) {
    result.categories = raw.categories.filter(
      (c): c is DebugEventCategory => typeof c === 'string' && VALID_CATEGORIES.has(c),
    );
  }
  if (typeof raw.minLevel === 'string' && VALID_LEVELS.has(raw.minLevel)) {
    result.minLevel = raw.minLevel as DebugEventLevel;
  }
  return result;
}

export function createDebugWebSocketHandler(debugBus: DebugBus) {
  const clients = new Map<ServerWebSocket<DebugWSData>, DebugEventCallback>();

  const handler = {
    open(ws: ServerWebSocket<DebugWSData>): void {
      if (clients.size >= MAX_DEBUG_CLIENTS) {
        safeSend(ws, { type: 'error', message: 'Too many debug connections' });
        ws.close();
        return;
      }

      // Send recent history on connect
      const history = debugBus.getRecent(200);
      const historyMsg: WSServerDebugHistory = {
        type: WSServerMessageType.DEBUG_HISTORY,
        events: history,
      };
      safeSend(ws, historyMsg);

      // Subscribe to live events
      const callback: DebugEventCallback = (event) => {
        if (!matchesFilter(event, ws.data.filter)) return;
        const msg: WSServerDebugEvent = {
          type: WSServerMessageType.DEBUG_EVENT,
          event,
        };
        safeSend(ws, msg);
      };

      clients.set(ws, callback);
      debugBus.subscribe(callback);
    },

    message(ws: ServerWebSocket<DebugWSData>, raw: string | Buffer): void {
      const text = typeof raw === 'string' ? raw : raw.toString();
      if (text.length > MAX_DEBUG_MESSAGE_SIZE) return;
      try {
        const parsed = JSON.parse(text) as WSClientDebugSubscribe;
        if (parsed.type === 'debug_subscribe' && parsed.filter) {
          ws.data.filter = validateFilter(parsed.filter);
        }
      } catch {
        // Ignore malformed messages
      }
    },

    close(ws: ServerWebSocket<DebugWSData>): void {
      const callback = clients.get(ws);
      if (callback) {
        debugBus.unsubscribe(callback);
        clients.delete(ws);
      }
    },
  };

  return {
    handler,
    getClientCount: () => clients.size,
    shutdown: () => {
      for (const [ws, callback] of clients) {
        debugBus.unsubscribe(callback);
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
