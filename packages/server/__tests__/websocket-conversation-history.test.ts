/**
 * WebSocket Conversation History — Tests for context amnesia fix.
 *
 * Bug: The conductor loses conversation context between messages because
 * each `claude -p` invocation uses `--no-session-persistence` and the
 * memory RAG can't compensate for short messages like "4" with no
 * semantic similarity to prior context.
 *
 * Fix requires:
 * 1. websocket.ts handleConductorMessage() fetches prior messages from
 *    sessionStore.getDetail(sessionId) and attaches them to
 *    IncomingMessage.metadata.conversationHistory
 * 2. conductor.ts formats conversation history into the prompt so the
 *    AI backend has the full conversation context.
 *
 * These tests will FAIL until the fix is implemented.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { Conductor, IncomingMessage } from '@autonomy/conductor';
import { MessageRole, WSClientMessageType, WSServerMessageType } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import { SessionStore } from '../src/session-store.ts';
import { createWebSocketHandler, type WSData } from '../src/websocket.ts';
import { MockConductor } from './helpers/mock-conductor.ts';

class MockWebSocket {
  sent: string[] = [];
  closed = false;
  data: WSData;

  constructor(id = 'ws-1', sessionId?: string) {
    this.data = { id, sessionId };
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

let testCounter = 0;
function uniqueWsId(prefix = 'ws-history'): string {
  return `${prefix}-${++testCounter}`;
}

describe('WebSocket conversation history injection', () => {
  let conductor: MockConductor;
  let db: Database;
  let sessionStore: SessionStore;
  let wsHandler: ReturnType<typeof createWebSocketHandler>;

  beforeEach(() => {
    conductor = new MockConductor();
    conductor.initialized = true;
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    sessionStore = new SessionStore(db);
    wsHandler = createWebSocketHandler(
      conductor as unknown as Conductor,
      undefined,
      sessionStore,
    );
  });

  // ──────────────────────────────────────────────
  // Test A: conversationHistory attached to IncomingMessage.metadata
  // ──────────────────────────────────────────────

  test('second message includes conversationHistory from prior messages', async () => {
    const session = sessionStore.create({ title: 'History Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    // Send first message — conductor mock replies with default response
    conductor.responseContent = 'Here are your options:\n1. Option A\n2. Option B\n3. Option C\n4. Option D';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Show me the options' }),
    );

    // Send second message — this is the one that should include history
    conductor.responseContent = 'You selected Option D.';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: '4' }),
    );

    // The second call to handleMessage should have conversationHistory as a typed field
    expect(conductor.handleMessageCalls.length).toBe(2);
    const secondCall = conductor.handleMessageCalls[1];
    expect(secondCall.conversationHistory).toBeDefined();

    const history = secondCall.conversationHistory as Array<{
      role: string;
      content: string;
    }>;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(2); // at least user + assistant from turn 1
  });

  test('first message has no conversationHistory (no prior context)', async () => {
    const session = sessionStore.create({ title: 'First Message Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Hello' }),
    );

    expect(conductor.handleMessageCalls.length).toBe(1);
    const firstCall = conductor.handleMessageCalls[0];

    // First message should either have no conversationHistory or empty array
    const history = firstCall.conversationHistory as
      | Array<{ role: string; content: string }>
      | undefined;
    if (history) {
      expect(history.length).toBe(0);
    }
    // If metadata is undefined or conversationHistory is undefined, that's also fine for first message
  });

  test('conversationHistory includes correct roles and content', async () => {
    const session = sessionStore.create({ title: 'Roles Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    conductor.responseContent = 'The capital of France is Paris.';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'What is the capital of France?' }),
    );

    conductor.responseContent = 'Paris has about 2.1 million people.';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'How many people live there?' }),
    );

    const secondCall = conductor.handleMessageCalls[1];
    const history = secondCall.conversationHistory as Array<{
      role: string;
      content: string;
    }>;

    expect(history).toBeDefined();
    expect(history.length).toBeGreaterThanOrEqual(2);

    // First entry should be user message
    const userMsg = history.find(
      (m) => m.role === MessageRole.USER && m.content === 'What is the capital of France?',
    );
    expect(userMsg).toBeDefined();

    // Second entry should be assistant response
    const assistantMsg = history.find(
      (m) =>
        m.role === MessageRole.ASSISTANT && m.content === 'The capital of France is Paris.',
    );
    expect(assistantMsg).toBeDefined();
  });

  test('conversationHistory does NOT include the current message', async () => {
    const session = sessionStore.create({ title: 'Exclude Current Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    conductor.responseContent = 'First response';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'First' }),
    );

    conductor.responseContent = 'Second response';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Second' }),
    );

    const secondCall = conductor.handleMessageCalls[1];
    const history = secondCall.conversationHistory as Array<{
      role: string;
      content: string;
    }>;

    expect(history).toBeDefined();
    // History should contain messages from BEFORE the current message
    // It should NOT contain "Second" as a user message in the history
    // (that's the current message being sent via content field)
    const currentInHistory = history.find(
      (m) => m.role === MessageRole.USER && m.content === 'Second',
    );
    expect(currentInHistory).toBeUndefined();
  });

  // ──────────────────────────────────────────────
  // Test B: Multi-turn conversation builds up history
  // ──────────────────────────────────────────────

  test('history accumulates across multiple turns', async () => {
    const session = sessionStore.create({ title: 'Accumulate Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    // Turn 1
    conductor.responseContent = 'Response 1';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Message 1' }),
    );

    // Turn 2
    conductor.responseContent = 'Response 2';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Message 2' }),
    );

    // Turn 3
    conductor.responseContent = 'Response 3';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Message 3' }),
    );

    const thirdCall = conductor.handleMessageCalls[2];
    const history = thirdCall.conversationHistory as Array<{
      role: string;
      content: string;
    }>;

    expect(history).toBeDefined();
    // Should have 4 messages: user1 + assistant1 + user2 + assistant2
    expect(history.length).toBeGreaterThanOrEqual(4);
  });

  // ──────────────────────────────────────────────
  // Test C: The amnesia scenario — "4" after numbered list
  // ──────────────────────────────────────────────

  test('short reply "4" includes full conversation context with numbered list', async () => {
    const session = sessionStore.create({ title: 'Amnesia Scenario' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    // User asks for options, conductor responds with a numbered list
    conductor.responseContent =
      'Here are the available frameworks:\n1. React\n2. Vue\n3. Angular\n4. Svelte';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({
        type: WSClientMessageType.MESSAGE,
        content: 'What frontend frameworks should I consider?',
      }),
    );

    // User sends "4" — this is the problematic message that loses context
    conductor.responseContent = 'Great choice! Svelte is...';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: '4' }),
    );

    const secondCall = conductor.handleMessageCalls[1];

    // The conversationHistory typed field MUST be present
    expect(secondCall.conversationHistory).toBeDefined();

    const history = secondCall.conversationHistory as Array<{
      role: string;
      content: string;
    }>;

    // The history must contain the numbered list response
    const listResponse = history.find(
      (m) => m.role === MessageRole.ASSISTANT && m.content.includes('Svelte'),
    );
    expect(listResponse).toBeDefined();

    // The history must contain the original question
    const originalQuestion = history.find(
      (m) => m.role === MessageRole.USER && m.content.includes('frontend frameworks'),
    );
    expect(originalQuestion).toBeDefined();
  });
});

// ──────────────────────────────────────────────
// Edge case tests
// ──────────────────────────────────────────────

describe('WebSocket conversation history — edge cases', () => {
  let conductor: MockConductor;
  let db: Database;
  let sessionStore: SessionStore;
  let wsHandler: ReturnType<typeof createWebSocketHandler>;

  beforeEach(() => {
    conductor = new MockConductor();
    conductor.initialized = true;
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    sessionStore = new SessionStore(db);
    wsHandler = createWebSocketHandler(
      conductor as unknown as Conductor,
      undefined,
      sessionStore,
    );
  });

  test('no sessionId — works without history', async () => {
    // No sessionId on the WebSocket — lazy session creation
    const ws = new MockWebSocket(uniqueWsId());
    wsHandler.handler.open(asWS(ws));

    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Hello no session' }),
    );

    // Should not crash and should still deliver response
    const messages = ws.allMessages();
    const chunkMsg = messages.find((m) => m.type === WSServerMessageType.CHUNK);
    expect(chunkMsg).toBeDefined();
    const completeMsg = messages.find((m) => m.type === WSServerMessageType.COMPLETE);
    expect(completeMsg).toBeDefined();
  });

  test('no sessionStore — works without history', async () => {
    // Create handler without session store
    const noStoreHandler = createWebSocketHandler(
      conductor as unknown as Conductor,
      undefined,
      undefined, // no session store
    );

    const ws = new MockWebSocket(uniqueWsId());
    noStoreHandler.handler.open(asWS(ws));

    await noStoreHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'No store message' }),
    );

    // Should not crash
    expect(conductor.handleMessageCalls.length).toBe(1);
    const call = conductor.handleMessageCalls[0];
    // Without session store, no history should be present
    const history = call.conversationHistory as
      | Array<{ role: string; content: string }>
      | undefined;
    expect(history).toBeUndefined();
  });

  test('very long history is capped to prevent prompt overflow', async () => {
    const session = sessionStore.create({ title: 'Long History Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    // Simulate 30 turns of conversation (60 messages: 30 user + 30 assistant)
    for (let i = 0; i < 30; i++) {
      conductor.responseContent = `Response ${i + 1}: ${'x'.repeat(200)}`;
      await wsHandler.handler.message(
        asWS(ws),
        JSON.stringify({
          type: WSClientMessageType.MESSAGE,
          content: `Message ${i + 1}: ${'y'.repeat(200)}`,
        }),
      );
    }

    // Send one more message — this should get a capped history
    conductor.responseContent = 'Final response';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Final message' }),
    );

    const lastCall = conductor.handleMessageCalls[conductor.handleMessageCalls.length - 1];
    const history = lastCall.conversationHistory as
      | Array<{ role: string; content: string }>
      | undefined;

    expect(history).toBeDefined();
    // History should be capped at MAX_HISTORY_MESSAGES (20). With 30 turns (60 messages)
    // sent before the final message, only the last 20 messages should be included.
    expect(history!.length).toBeLessThanOrEqual(20);
    expect(history!.length).toBeGreaterThan(0);

    // The most recent messages should be preserved (not oldest)
    const lastHistoryMsg = history![history!.length - 1];
    // The last message in history should be the assistant response from the 30th turn
    // (the 31st user message "Final message" is the current message, not in history)
    expect(lastHistoryMsg.role).toBe(MessageRole.ASSISTANT);
  });

  test('history survives WebSocket reconnect within same session', async () => {
    const session = sessionStore.create({ title: 'Reconnect Test' });

    // First connection — send a message
    const ws1 = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws1));

    conductor.responseContent = 'I remember this';
    await wsHandler.handler.message(
      asWS(ws1),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Remember me' }),
    );

    // Simulate disconnect + reconnect with same session ID
    wsHandler.handler.close(asWS(ws1));

    const ws2 = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws2));

    conductor.responseContent = 'I still know the context';
    await wsHandler.handler.message(
      asWS(ws2),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Do you remember?' }),
    );

    // The second connection's message should include history from the first connection
    const reconnectCall = conductor.handleMessageCalls[1];
    const history = reconnectCall.conversationHistory as Array<{
      role: string;
      content: string;
    }>;

    expect(history).toBeDefined();
    expect(history.length).toBeGreaterThanOrEqual(2);

    const priorUserMsg = history.find(
      (m) => m.role === MessageRole.USER && m.content === 'Remember me',
    );
    expect(priorUserMsg).toBeDefined();

    const priorAssistantMsg = history.find(
      (m) => m.role === MessageRole.ASSISTANT && m.content === 'I remember this',
    );
    expect(priorAssistantMsg).toBeDefined();
  });

  test('targeted agent messages include conversationHistory', async () => {
    const session = sessionStore.create({ title: 'Targeted Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    conductor.responseContent = 'Agent response 1';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({
        type: WSClientMessageType.MESSAGE,
        content: 'Hello agent',
        targetAgent: 'agent-1',
      }),
    );

    conductor.responseContent = 'Agent response 2';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({
        type: WSClientMessageType.MESSAGE,
        content: 'Follow up',
        targetAgent: 'agent-1',
      }),
    );

    const secondCall = conductor.handleMessageCalls[1];
    const history = secondCall.conversationHistory as Array<{
      role: string;
      content: string;
    }>;

    expect(history).toBeDefined();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  test('configOverrides in metadata are preserved alongside conversationHistory', async () => {
    const session = sessionStore.create({ title: 'Override Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    ws.data.configOverrides = { model: 'sonnet' };
    wsHandler.handler.open(asWS(ws));

    conductor.responseContent = 'First response';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'First' }),
    );

    conductor.responseContent = 'Second response';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Second' }),
    );

    const secondCall = conductor.handleMessageCalls[1];
    expect(secondCall.metadata).toBeDefined();

    // Both configOverrides and conversationHistory should coexist
    expect(secondCall.metadata?.configOverrides).toBeDefined();
    expect((secondCall.metadata?.configOverrides as Record<string, string>).model).toBe(
      'sonnet',
    );
    expect(secondCall.conversationHistory).toBeDefined();
  });
});

// ──────────────────────────────────────────────
// Conductor-level tests — buildMemoryAugmentedPrompt with history
// ──────────────────────────────────────────────

describe('Conductor prompt with conversation history', () => {
  let conductor: MockConductor;
  let db: Database;
  let sessionStore: SessionStore;
  let wsHandler: ReturnType<typeof createWebSocketHandler>;

  beforeEach(() => {
    conductor = new MockConductor();
    conductor.initialized = true;
    db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    sessionStore = new SessionStore(db);
    wsHandler = createWebSocketHandler(
      conductor as unknown as Conductor,
      undefined,
      sessionStore,
    );
  });

  test('IncomingMessage with conversationHistory reaches conductor', async () => {
    const session = sessionStore.create({ title: 'Conductor Test' });
    const ws = new MockWebSocket(uniqueWsId(), session.id);
    wsHandler.handler.open(asWS(ws));

    // Turn 1
    conductor.responseContent = 'Pick a number: 1, 2, or 3';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: 'Give me options' }),
    );

    // Turn 2 — the "amnesia" message
    conductor.responseContent = 'You picked 2!';
    await wsHandler.handler.message(
      asWS(ws),
      JSON.stringify({ type: WSClientMessageType.MESSAGE, content: '2' }),
    );

    // Verify the conductor received the history
    const secondIncoming = conductor.handleMessageCalls[1];
    expect(secondIncoming.content).toBe('2');
    expect(secondIncoming.conversationHistory).toBeDefined();

    const history = secondIncoming.conversationHistory as Array<{
      role: string;
      content: string;
    }>;

    // Conductor should receive the prior turn
    expect(history.some((m) => m.content.includes('Give me options'))).toBe(true);
    expect(history.some((m) => m.content.includes('Pick a number'))).toBe(true);
  });
});
