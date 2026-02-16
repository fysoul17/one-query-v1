import { beforeEach, describe, expect, test } from 'bun:test';
import type { DebugEvent } from '@autonomy/shared';
import { DebugEventCategory, DebugEventLevel, WSServerMessageType } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import { DebugBus } from '../src/debug-bus.ts';
import { createDebugWebSocketHandler, type DebugWSData } from '../src/debug-websocket.ts';

function fakeEvent(overrides: Partial<DebugEvent> = {}): DebugEvent {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    timestamp: new Date().toISOString(),
    category: DebugEventCategory.SYSTEM,
    level: DebugEventLevel.INFO,
    source: 'test',
    message: 'test event',
    ...overrides,
  };
}

class MockDebugWebSocket {
  sent: string[] = [];
  closed = false;
  data: DebugWSData;

  constructor(id = 'debug-ws-1') {
    this.data = { id, type: 'debug' };
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  allMessages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  lastMessage(): Record<string, unknown> | null {
    const last = this.sent[this.sent.length - 1];
    return last ? (JSON.parse(last) as Record<string, unknown>) : null;
  }
}

function asWS(ws: MockDebugWebSocket): ServerWebSocket<DebugWSData> {
  return ws as unknown as ServerWebSocket<DebugWSData>;
}

describe('createDebugWebSocketHandler', () => {
  let bus: DebugBus;
  let handler: ReturnType<typeof createDebugWebSocketHandler>;

  beforeEach(() => {
    bus = new DebugBus(100);
    handler = createDebugWebSocketHandler(bus);
  });

  test('open sends debug_history on connect', () => {
    // Emit some events before connecting
    bus.emit(fakeEvent({ id: 'hist-1' }));
    bus.emit(fakeEvent({ id: 'hist-2' }));

    const ws = new MockDebugWebSocket();
    handler.handler.open(asWS(ws));

    const msgs = ws.allMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe(WSServerMessageType.DEBUG_HISTORY);
    const events = msgs[0].events as DebugEvent[];
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('hist-1');
    expect(events[1].id).toBe('hist-2');
  });

  test('open subscribes to live events', () => {
    const ws = new MockDebugWebSocket();
    handler.handler.open(asWS(ws));
    // clear history message
    ws.sent = [];

    bus.emit(fakeEvent({ id: 'live-1' }));

    const msgs = ws.allMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe(WSServerMessageType.DEBUG_EVENT);
    expect((msgs[0].event as DebugEvent).id).toBe('live-1');
  });

  test('open rejects when MAX_DEBUG_CLIENTS exceeded', () => {
    // Connect 20 clients (the max)
    const clients: MockDebugWebSocket[] = [];
    for (let i = 0; i < 20; i++) {
      const ws = new MockDebugWebSocket(`client-${i}`);
      handler.handler.open(asWS(ws));
      clients.push(ws);
    }
    expect(handler.getClientCount()).toBe(20);

    // 21st should be rejected
    const ws21 = new MockDebugWebSocket('client-20');
    handler.handler.open(asWS(ws21));
    expect(ws21.closed).toBe(true);
    const msg = ws21.lastMessage();
    expect(msg?.type).toBe('error');
    expect(handler.getClientCount()).toBe(20);
  });

  test('message with debug_subscribe updates client filter', () => {
    const ws = new MockDebugWebSocket();
    handler.handler.open(asWS(ws));
    ws.sent = [];

    // Set filter to only conductor events
    const subscribeMsg = JSON.stringify({
      type: 'debug_subscribe',
      filter: {
        categories: ['conductor'],
        minLevel: 'warn',
      },
    });
    handler.handler.message(asWS(ws), subscribeMsg);

    // Emit non-matching event (agent + info)
    bus.emit(fakeEvent({ category: DebugEventCategory.AGENT, level: DebugEventLevel.INFO }));
    expect(ws.sent).toHaveLength(0);

    // Emit matching event (conductor + error)
    bus.emit(fakeEvent({ category: DebugEventCategory.CONDUCTOR, level: DebugEventLevel.ERROR }));
    expect(ws.sent).toHaveLength(1);
  });

  test('message validates filter categories', () => {
    const ws = new MockDebugWebSocket();
    handler.handler.open(asWS(ws));
    ws.sent = [];

    // Send filter with invalid categories
    const subscribeMsg = JSON.stringify({
      type: 'debug_subscribe',
      filter: {
        categories: ['conductor', 'invalid_category', 123],
        minLevel: 'bogus',
      },
    });
    handler.handler.message(asWS(ws), subscribeMsg);

    // Filter should only keep valid category 'conductor', minLevel should be undefined
    // Emit conductor+debug — should pass because minLevel is not set (invalid was stripped)
    bus.emit(fakeEvent({ category: DebugEventCategory.CONDUCTOR, level: DebugEventLevel.DEBUG }));
    expect(ws.sent).toHaveLength(1);

    // Emit agent+debug — should NOT pass (category filter is conductor only)
    bus.emit(fakeEvent({ category: DebugEventCategory.AGENT, level: DebugEventLevel.DEBUG }));
    expect(ws.sent).toHaveLength(1); // still 1
  });

  test('message ignores malformed JSON', () => {
    const ws = new MockDebugWebSocket();
    handler.handler.open(asWS(ws));
    ws.sent = [];

    // Should not throw
    handler.handler.message(asWS(ws), 'not valid json');
    handler.handler.message(asWS(ws), '');
    expect(ws.sent).toHaveLength(0);
  });

  test('message ignores oversized messages', () => {
    const ws = new MockDebugWebSocket();
    handler.handler.open(asWS(ws));
    ws.sent = [];

    const hugeMsg = 'x'.repeat(5000); // > 4096 limit
    handler.handler.message(asWS(ws), hugeMsg);
    // Should be silently ignored (no error sent, no crash)
    expect(ws.sent).toHaveLength(0);
  });

  test('close unsubscribes from debug bus and removes client', () => {
    const ws = new MockDebugWebSocket();
    handler.handler.open(asWS(ws));
    expect(handler.getClientCount()).toBe(1);
    expect(bus.getSubscriberCount()).toBe(1);

    handler.handler.close(asWS(ws));
    expect(handler.getClientCount()).toBe(0);
    expect(bus.getSubscriberCount()).toBe(0);

    // Events should not be sent to closed client
    ws.sent = [];
    bus.emit(fakeEvent());
    expect(ws.sent).toHaveLength(0);
  });

  test('getClientCount returns accurate count', () => {
    expect(handler.getClientCount()).toBe(0);

    const ws1 = new MockDebugWebSocket('ws-1');
    const ws2 = new MockDebugWebSocket('ws-2');
    handler.handler.open(asWS(ws1));
    handler.handler.open(asWS(ws2));
    expect(handler.getClientCount()).toBe(2);

    handler.handler.close(asWS(ws1));
    expect(handler.getClientCount()).toBe(1);
  });

  test('shutdown unsubscribes all and closes all clients', () => {
    const ws1 = new MockDebugWebSocket('ws-1');
    const ws2 = new MockDebugWebSocket('ws-2');
    handler.handler.open(asWS(ws1));
    handler.handler.open(asWS(ws2));

    handler.shutdown();

    expect(ws1.closed).toBe(true);
    expect(ws2.closed).toBe(true);
    expect(handler.getClientCount()).toBe(0);
    expect(bus.getSubscriberCount()).toBe(0);
  });

  test('live events without filter reach all clients', () => {
    const ws1 = new MockDebugWebSocket('ws-1');
    const ws2 = new MockDebugWebSocket('ws-2');
    handler.handler.open(asWS(ws1));
    handler.handler.open(asWS(ws2));
    ws1.sent = [];
    ws2.sent = [];

    bus.emit(fakeEvent({ id: 'broadcast-1' }));

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);
  });
});
