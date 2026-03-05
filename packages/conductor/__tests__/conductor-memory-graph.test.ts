import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ConductorDecision, MemoryInterface } from '@autonomy/shared';
import { MemoryType, StoreTarget } from '@autonomy/shared';
import type { StoreConversationContext } from '../src/conductor-memory.ts';
import { storeConversation } from '../src/conductor-memory.ts';
import { MockMemory } from './helpers/mock-memory.ts';
import { makeMessage } from './helpers/mock-registry.ts';

/**
 * Tests that storeConversation() extracts entities via LLM and passes them
 * to memory.store() with graph targets for knowledge graph population.
 * Without an API key, falls back to default targets (sqlite+vector).
 */

// Mock the entity extractor to avoid real API calls in tests
const mockExtractEntities = mock(() =>
  Promise.resolve({ entities: [], relationships: [] }),
);
mock.module('../src/entity-extractor.ts', () => ({
  extractEntities: mockExtractEntities,
}));

function makeCtx(overrides?: Partial<StoreConversationContext>): StoreConversationContext {
  return {
    memory: new MockMemory() as unknown as MemoryInterface,
    memoryConnected: true,
    ...overrides,
  };
}

describe('storeConversation — graph ingestion', () => {
  let memory: MockMemory;
  let ctx: StoreConversationContext;
  let decisions: ConductorDecision[];

  beforeEach(() => {
    memory = new MockMemory();
    ctx = makeCtx({ memory: memory as unknown as MemoryInterface });
    decisions = [];
    mockExtractEntities.mockReset();
    mockExtractEntities.mockResolvedValue({ entities: [], relationships: [] });
  });

  test('store call uses default targets when no entities extracted', async () => {
    const msg = makeMessage({ content: 'Hello, how are you?' });
    await storeConversation(ctx, msg, decisions);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].targets).toBeUndefined();
    expect(memory.storeCalls[0].entities).toBeUndefined();
  });

  test('store call includes graph targets when entities extracted', async () => {
    mockExtractEntities.mockResolvedValue({
      entities: [
        { name: 'Alice', type: 'PERSON' },
        { name: 'Acme Corp', type: 'ORGANIZATION' },
      ],
      relationships: [{ source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' }],
    });

    ctx.llmApiKey = 'test-api-key';
    const msg = makeMessage({ content: 'Alice works at Acme Corp' });
    await storeConversation(ctx, msg, decisions);

    expect(memory.storeCalls).toHaveLength(1);
    const call = memory.storeCalls[0];
    expect(call.targets).toEqual([StoreTarget.SQLITE, StoreTarget.VECTOR, StoreTarget.GRAPH]);
    expect(call.entities).toEqual([
      { name: 'Alice', type: 'PERSON' },
      { name: 'Acme Corp', type: 'ORGANIZATION' },
    ]);
    expect(call.relationships).toEqual([
      { source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' },
    ]);
  });

  test('entity extraction receives combined user + assistant content', async () => {
    ctx.llmApiKey = 'test-api-key';
    const msg = makeMessage({ content: 'Tell me about Alice' });
    await storeConversation(ctx, msg, decisions, 'Alice is a developer at Acme Corp.');

    expect(mockExtractEntities).toHaveBeenCalledTimes(1);
    const [text] = mockExtractEntities.mock.calls[0];
    expect(text).toContain('Tell me about Alice');
    expect(text).toContain('Alice is a developer at Acme Corp.');
  });

  test('store call falls back to defaults without API key', async () => {
    const msg = makeMessage({ content: 'Alice works at Acme Corp' });
    await storeConversation(ctx, msg, decisions);

    expect(memory.storeCalls).toHaveLength(1);
    expect(memory.storeCalls[0].targets).toBeUndefined();
    expect(memory.storeCalls[0].entities).toBeUndefined();
  });

  test('graph data only stored on user message, not assistant response', async () => {
    mockExtractEntities.mockResolvedValue({
      entities: [{ name: 'TypeScript', type: 'TOOL' }],
      relationships: [],
    });

    ctx.llmApiKey = 'test-api-key';
    const msg = makeMessage({ content: 'What tools does the project use?' });
    await storeConversation(ctx, msg, decisions, 'The project uses TypeScript.');

    expect(memory.storeCalls).toHaveLength(2);
    // User message: has graph targets
    expect(memory.storeCalls[0].targets).toEqual([StoreTarget.SQLITE, StoreTarget.VECTOR, StoreTarget.GRAPH]);
    expect(memory.storeCalls[0].entities).toEqual([{ name: 'TypeScript', type: 'TOOL' }]);
    // Assistant response: no graph data (already ingested above)
    expect(memory.storeCalls[1].targets).toBeUndefined();
    expect(memory.storeCalls[1].entities).toBeUndefined();
  });

  test('store call preserves core fields alongside graph data', async () => {
    mockExtractEntities.mockResolvedValue({
      entities: [{ name: 'Bob', type: 'PERSON' }],
      relationships: [],
    });

    ctx.llmApiKey = 'test-api-key';
    const msg = makeMessage({
      content: 'Bob joined the team',
      senderId: 'agent-1',
      sessionId: 'sess-1',
      senderName: 'TestBot',
    });
    await storeConversation(ctx, msg, decisions);

    expect(memory.storeCalls).toHaveLength(1);
    const call = memory.storeCalls[0];
    expect(call.content).toBe('Bob joined the team');
    expect(call.type).toBe(MemoryType.SHORT_TERM);
    expect(call.agentId).toBe('agent-1');
    expect(call.sessionId).toBe('sess-1');
    expect(call.metadata).toEqual({ senderName: 'TestBot' });
    expect(call.entities).toEqual([{ name: 'Bob', type: 'PERSON' }]);
  });
});
