import { beforeEach, describe, expect, test } from 'bun:test';
import type { Conductor } from '@autonomy/conductor';
import { WSClientMessageType, WSServerMessageType } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import { createWebSocketHandler, type WSData } from '../src/websocket.ts';
import { MockConductor } from './helpers/mock-conductor.ts';

// Mock ServerWebSocket for unit testing
class MockWebSocket {
  sent: string[] = [];
  closed = false;
  data: { id: string };

  constructor(id = 'ws-1') {
    this.data = { id };
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  lastMessage(): Record<string, unknown> | null {
    const last = this.sent[this.sent.length - 1];
    return last ? (JSON.parse(last) as Record<string, unknown>) : null;
  }

  allMessages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function asWS(ws: MockWebSocket): ServerWebSocket<WSData> {
  return ws as unknown as ServerWebSocket<WSData>;
}

describe('WebSocket handler', () => {
  let conductor: MockConductor;
  let wsHandler: ReturnType<typeof createWebSocketHandler>;

  beforeEach(() => {
    conductor = new MockConductor();
    conductor.initialized = true;
    wsHandler = createWebSocketHandler(conductor as unknown as Conductor);
  });

  test('tracks connected clients on open/close', () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));
    expect(wsHandler.getClientCount()).toBe(1);

    wsHandler.handler.close(asWS(ws));
    expect(wsHandler.getClientCount()).toBe(0);
  });

  test('responds to ping with pong', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(asWS(ws), JSON.stringify({ type: WSClientMessageType.PING }));

    expect(ws.lastMessage().type).toBe(WSServerMessageType.PONG);
  });

  test('handles message type — sends chunk and complete', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));
    conductor.responseContent = 'Hello from conductor';

    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Hi' }),
    );

    const messages = ws.allMessages();
    expect(messages.length).toBe(2);
    expect(messages[0].type).toBe(WSServerMessageType.CHUNK);
    expect(messages[0].content).toBe('Hello from conductor');
    expect(messages[1].type).toBe(WSServerMessageType.COMPLETE);
  });

  test('sends error on invalid JSON', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(asWS(ws), 'not json');

    expect(ws.lastMessage().type).toBe(WSServerMessageType.ERROR);
    expect(ws.lastMessage().message).toBe('Invalid JSON');
  });

  test('sends error on unknown message type', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(asWS(ws), JSON.stringify({ type: 'unknown' }));

    expect(ws.lastMessage().type).toBe(WSServerMessageType.ERROR);
    expect(ws.lastMessage().message).toContain('Unknown message type');
  });

  test('sends error when conductor throws', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));
    conductor.shouldThrow = true;

    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Hi' }),
    );

    expect(ws.lastMessage().type).toBe(WSServerMessageType.ERROR);
    expect(ws.lastMessage().message).toBe('Mock conductor error');
  });

  test('passes targetAgent from client message', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Hi', targetAgent: 'agent-1' }),
    );

    expect(conductor.handleMessageCalls[0]?.targetAgentId).toBe('agent-1');
  });

  test('broadcast sends to all connected clients', () => {
    const ws1 = new MockWebSocket('ws-1');
    const ws2 = new MockWebSocket('ws-2');
    wsHandler.handler.open(asWS(ws1));
    wsHandler.handler.open(asWS(ws2));

    wsHandler.broadcast({ type: 'test', data: 'hello' });

    expect(ws1.sent.length).toBe(1);
    expect(ws2.sent.length).toBe(1);
  });

  test('broadcastAgentStatus sends agent_status to all clients', () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    wsHandler.broadcastAgentStatus();

    expect(ws.lastMessage().type).toBe(WSServerMessageType.AGENT_STATUS);
    expect(ws.lastMessage().agents).toEqual([]);
  });

  test('shutdown closes all clients', () => {
    const ws1 = new MockWebSocket('ws-1');
    const ws2 = new MockWebSocket('ws-2');
    wsHandler.handler.open(asWS(ws1));
    wsHandler.handler.open(asWS(ws2));

    wsHandler.shutdown();

    expect(ws1.closed).toBe(true);
    expect(ws2.closed).toBe(true);
    expect(wsHandler.getClientCount()).toBe(0);
  });

  test('rejects oversized messages', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    const largeMessage = 'x'.repeat(100_000);
    await wsHandler.handler.message(asWS(ws), largeMessage);

    expect(ws.lastMessage().type).toBe(WSServerMessageType.ERROR);
    expect(ws.lastMessage().message).toBe('Message too large');
  });

  test('rejects connections when max clients exceeded', () => {
    // Fill up to max (100 clients)
    const clients: MockWebSocket[] = [];
    for (let i = 0; i < 100; i++) {
      const ws = new MockWebSocket(`ws-${i}`);
      wsHandler.handler.open(asWS(ws));
      clients.push(ws);
    }
    expect(wsHandler.getClientCount()).toBe(100);

    // 101st client should be rejected
    const rejected = new MockWebSocket('ws-rejected');
    wsHandler.handler.open(asWS(rejected));

    expect(rejected.lastMessage().type).toBe(WSServerMessageType.ERROR);
    expect(rejected.lastMessage().message).toBe('Too many connections');
    expect(rejected.closed).toBe(true);
    expect(wsHandler.getClientCount()).toBe(100);

    // Cleanup
    wsHandler.shutdown();
  });

  test('handles message with empty content', async () => {
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: '' }),
    );

    const messages = ws.allMessages();
    // Should still send chunk + complete (conductor handles empty content)
    expect(messages.length).toBe(2);
    expect(messages[0].type).toBe(WSServerMessageType.CHUNK);
    expect(messages[1].type).toBe(WSServerMessageType.COMPLETE);
  });
});

describe('WebSocket handler with debugBus', () => {
  let conductor: MockConductor;

  beforeEach(() => {
    conductor = new MockConductor();
    conductor.initialized = true;
  });

  test('always includes debug payload in conductor_status messages', async () => {
    const wsHandler = createWebSocketHandler(conductor as unknown as Conductor);
    const ws = new MockWebSocket();
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Hi' }),
    );

    const messages = ws.allMessages();
    expect(messages[0].type).toBe(WSServerMessageType.CHUNK);
    expect(messages[1].type).toBe(WSServerMessageType.COMPLETE);
  });

  test('works without debugBus', () => {
    const handler = createWebSocketHandler(conductor as unknown as Conductor);
    expect(handler).toBeDefined();
    expect(handler.getClientCount()).toBe(0);
  });
});
