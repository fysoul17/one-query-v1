import { beforeEach, describe, expect, test } from 'bun:test';
import type { ConductorDecision, MemoryInterface } from '@autonomy/shared';
import { HookName, MemoryType, RAGStrategy } from '@autonomy/shared';
import type { StoreConversationContext } from '../src/conductor-memory.ts';
import { searchMemoryContext, storeConversation } from '../src/conductor-memory.ts';
import { MockMemory } from './helpers/mock-memory.ts';
import { createMockRegistry, makeMessage } from './helpers/mock-registry.ts';

describe('searchMemoryContext', () => {
  let memory: MockMemory;

  beforeEach(() => {
    memory = new MockMemory();
  });

  test('searches memory with correct parameters', async () => {
    const msg = makeMessage();
    await searchMemoryContext(memory, msg);
    expect(memory.searchCalls).toHaveLength(1);
    expect(memory.searchCalls[0].query).toBe('Hello world');
    expect(memory.searchCalls[0].limit).toBe(5);
    expect(memory.searchCalls[0].strategy).toBe(RAGStrategy.HYBRID);
  });

  test('includes agentId when sessionId is present', async () => {
    const msg = makeMessage({ sessionId: 'sess-1', senderId: 'agent-1' });
    await searchMemoryContext(memory, msg);
    expect(memory.searchCalls[0].agentId).toBe('agent-1');
  });

  test('omits agentId when sessionId is absent', async () => {
    const msg = makeMessage({ sessionId: undefined });
    await searchMemoryContext(memory, msg);
    expect(memory.searchCalls[0].agentId).toBeUndefined();
  });

  test('returns search results on success', async () => {
    const expected = { entries: [], totalCount: 0, strategy: RAGStrategy.NAIVE };
    memory.setSearchResults(expected);
    const msg = makeMessage();
    const result = await searchMemoryContext(memory, msg);
    expect(result).toBe(expected);
  });

  test('returns null on search failure', async () => {
    memory.setShouldThrow(true);
    const msg = makeMessage();
    const result = await searchMemoryContext(memory, msg);
    expect(result).toBeNull();
  });
});

describe('storeConversation', () => {
  let memory: MockMemory;
  let ctx: StoreConversationContext;
  let decisions: ConductorDecision[];

  beforeEach(() => {
    memory = new MockMemory();
    ctx = { memory: memory as unknown as MemoryInterface, memoryConnected: true };
    decisions = [];
  });

  test('skips storage when memory is not connected', async () => {
    ctx.memoryConnected = false;
    const msg = makeMessage();
    await storeConversation(ctx, msg, decisions);
    expect(memory.storeCalls).toHaveLength(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('skip_memory');
    expect(decisions[0].reason).toBe('Memory service not connected');
  });

  test('skips storage when message content is empty', async () => {
    const msg = makeMessage({ content: '   ' });
    await storeConversation(ctx, msg, decisions);
    expect(memory.storeCalls).toHaveLength(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('skip_memory');
    expect(decisions[0].reason).toBe('Empty message content');
  });

  test('stores user message in SHORT_TERM memory', async () => {
    const msg = makeMessage();
    await storeConversation(ctx, msg, decisions);
    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].content).toBe('Hello world');
    expect(memory.storeCalls[0].type).toBe(MemoryType.SHORT_TERM);
  });

  test('stores assistant response in EPISODIC memory', async () => {
    const msg = makeMessage();
    await storeConversation(ctx, msg, decisions, 'Assistant reply');
    expect(memory.storeCalls).toHaveLength(2);
    expect(memory.storeCalls[1].content).toBe('Assistant reply');
    expect(memory.storeCalls[1].type).toBe(MemoryType.EPISODIC);
  });

  test('does not store empty assistant response', async () => {
    const msg = makeMessage();
    await storeConversation(ctx, msg, decisions, '   ');
    expect(memory.storeCalls).toHaveLength(1);
  });

  test('does not store undefined assistant response', async () => {
    const msg = makeMessage();
    await storeConversation(ctx, msg, decisions, undefined);
    expect(memory.storeCalls).toHaveLength(1);
  });

  test('pushes store_memory decision on success', async () => {
    const msg = makeMessage();
    await storeConversation(ctx, msg, decisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('store_memory');
  });

  test('handles memory store error gracefully', async () => {
    memory.setShouldThrow(true);
    const msg = makeMessage();
    await storeConversation(ctx, msg, decisions);
    // No decision pushed for failed store, no exception thrown
    expect(decisions).toHaveLength(0);
  });

  describe('BEFORE_MEMORY_STORE hook', () => {
    test('calls hook with correct data', async () => {
      const msg = makeMessage();
      const registry = createMockRegistry({
        content: 'Hello world',
        metadata: { senderName: 'TestAgent' },
      });
      ctx.hookRegistry = registry;
      await storeConversation(ctx, msg, decisions);
      expect(registry.calls).toHaveLength(1);
      expect(registry.calls[0].hookType).toBe(HookName.BEFORE_MEMORY_STORE);
      const data = registry.calls[0].data as {
        content: string;
        agentId: string;
        sessionId: string;
      };
      expect(data.content).toBe('Hello world');
      expect(data.agentId).toBe('agent-1');
      expect(data.sessionId).toBe('sess-1');
    });

    test('skips storage when hook returns null', async () => {
      const msg = makeMessage();
      ctx.hookRegistry = createMockRegistry(null);
      await storeConversation(ctx, msg, decisions);
      expect(memory.storeCalls).toHaveLength(0);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('skip_memory');
      expect(decisions[0].reason).toBe('Memory store skipped by plugin');
    });

    test('skips storage when hook returns undefined', async () => {
      const msg = makeMessage();
      ctx.hookRegistry = createMockRegistry(undefined);
      await storeConversation(ctx, msg, decisions);
      expect(memory.storeCalls).toHaveLength(0);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].reason).toBe('Memory store skipped by plugin');
    });

    test('uses modified content from hook', async () => {
      const msg = makeMessage();
      ctx.hookRegistry = createMockRegistry({
        content: 'modified by plugin',
        metadata: { custom: true },
      });
      await storeConversation(ctx, msg, decisions);
      expect(memory.storeCalls).toHaveLength(1);
      expect(memory.storeCalls[0].content).toBe('modified by plugin');
    });
  });
});
