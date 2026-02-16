import { describe, expect, test } from 'bun:test';
import type { AgentPool } from '@autonomy/agent-manager';
import type { Memory } from '@autonomy/memory';
import {
  type AgentDefinition,
  type AgentRuntimeInfo,
  AgentStatus,
  RAGStrategy,
} from '@autonomy/shared';
import { Conductor } from '../src/conductor.ts';
import { type ConductorEvent, ConductorEventType } from '../src/types.ts';
import { makeMessage } from './helpers/fixtures.ts';
import { MockMemory } from './helpers/mock-memory.ts';

function createMockPool() {
  const agents = new Map<string, { definition: AgentDefinition; runtime: AgentRuntimeInfo }>();
  let sendResponse = 'Mock response';

  return {
    setSendResponse(r: string) {
      sendResponse = r;
    },
    create: async (definition: AgentDefinition) => {
      const runtime: AgentRuntimeInfo = {
        id: definition.id,
        name: definition.name,
        role: definition.role,
        status: AgentStatus.IDLE,
        owner: definition.owner,
        persistent: definition.persistent,
        createdAt: definition.createdAt,
      };
      agents.set(definition.id, { definition, runtime });
      return { id: definition.id, definition, toRuntimeInfo: () => runtime };
    },
    get: (id: string) => {
      const entry = agents.get(id);
      if (!entry) return undefined;
      return { definition: entry.definition, toRuntimeInfo: () => entry.runtime };
    },
    list: () => [...agents.values()].map((a) => a.runtime),
    remove: async (id: string) => {
      agents.delete(id);
    },
    sendMessage: async (_id: string, _msg: string) => sendResponse,
    shutdown: async () => {
      agents.clear();
    },
  };
}

describe('Conductor debug events', () => {
  test('emits MEMORY_SEARCH event with durationMs and memoryResults', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const memorySearch = events.find((e) => e.type === ConductorEventType.MEMORY_SEARCH);
    expect(memorySearch).toBeDefined();
    expect(memorySearch?.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof memorySearch?.memoryResults).toBe('number');
  });

  test('emits ROUTING_COMPLETE event with durationMs and routerType', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const routingComplete = events.find((e) => e.type === ConductorEventType.ROUTING_COMPLETE);
    expect(routingComplete).toBeDefined();
    expect(routingComplete?.durationMs).toBeGreaterThanOrEqual(0);
    expect(routingComplete?.routerType).toBe('keyword'); // no backend = keyword router
  });

  test('emits DELEGATION_COMPLETE event with durationMs and decisions', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const delegationComplete = events.find(
      (e) => e.type === ConductorEventType.DELEGATION_COMPLETE,
    );
    expect(delegationComplete).toBeDefined();
    expect(delegationComplete?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(delegationComplete?.decisions)).toBe(true);
  });

  test('emits MEMORY_STORE event with durationMs', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const memoryStore = events.find((e) => e.type === ConductorEventType.MEMORY_STORE);
    expect(memoryStore).toBeDefined();
    expect(memoryStore?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('durationMs values are non-negative integers', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const timedEvents = events.filter((e) => e.durationMs !== undefined);
    expect(timedEvents.length).toBeGreaterThanOrEqual(4);
    for (const event of timedEvents) {
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(event.durationMs)).toBe(true);
    }
  });

  test('MEMORY_SEARCH reports correct entry count', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    memory.setSearchResults({
      entries: [
        { id: '1', content: 'a', type: 'short_term' as never, createdAt: '', metadata: {} },
        { id: '2', content: 'b', type: 'short_term' as never, createdAt: '', metadata: {} },
      ],
      totalCount: 2,
      strategy: RAGStrategy.NAIVE,
    });

    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const memorySearch = events.find((e) => e.type === ConductorEventType.MEMORY_SEARCH);
    expect(memorySearch?.memoryResults).toBe(2);
  });

  test('MEMORY_SEARCH reports 0 when memory search throws', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    memory.setShouldThrow(true);

    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const memorySearch = events.find((e) => e.type === ConductorEventType.MEMORY_SEARCH);
    expect(memorySearch?.memoryResults).toBe(0);
  });

  test('emits all debug events in correct order', async () => {
    const pool = createMockPool();
    const memory = new MockMemory();
    const conductor = new Conductor(pool as unknown as AgentPool, memory as unknown as Memory);
    await conductor.initialize();

    const events: ConductorEvent[] = [];
    await conductor.handleMessage(makeMessage(), (e) => events.push(e));

    const debugTypes = events.map((e) => e.type);
    const memorySearchIdx = debugTypes.indexOf(ConductorEventType.MEMORY_SEARCH);
    const routingCompleteIdx = debugTypes.indexOf(ConductorEventType.ROUTING_COMPLETE);
    const delegationCompleteIdx = debugTypes.indexOf(ConductorEventType.DELEGATION_COMPLETE);
    const memoryStoreIdx = debugTypes.indexOf(ConductorEventType.MEMORY_STORE);

    // All should exist
    expect(memorySearchIdx).toBeGreaterThanOrEqual(0);
    expect(routingCompleteIdx).toBeGreaterThanOrEqual(0);
    expect(delegationCompleteIdx).toBeGreaterThanOrEqual(0);
    expect(memoryStoreIdx).toBeGreaterThanOrEqual(0);

    // Order: memory_search before routing_complete before delegation_complete before memory_store
    expect(memorySearchIdx).toBeLessThan(routingCompleteIdx);
    expect(routingCompleteIdx).toBeLessThan(delegationCompleteIdx);
    expect(delegationCompleteIdx).toBeLessThan(memoryStoreIdx);
  });
});
