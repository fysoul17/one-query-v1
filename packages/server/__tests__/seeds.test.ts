import { describe, expect, mock, test } from 'bun:test';
import type { AgentDefinition } from '@autonomy/shared';
import { runCronSeeds, runSeeds } from '../src/seeds/index.ts';

describe('runSeeds', () => {
  test('seeds agents into the store', async () => {
    const upserted: string[] = [];
    const mockStore = {
      upsertSeed: mock((agent: AgentDefinition) => {
        upserted.push(agent.id);
        return true; // newly inserted
      }),
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of AgentStoreInterface
    } as any;
    // biome-ignore lint/suspicious/noExplicitAny: test mock — AgentPool not needed for seed logic
    const mockPool = {} as any;

    await runSeeds(mockPool, mockStore);

    expect(upserted.length).toBeGreaterThanOrEqual(3);
    expect(upserted).toContain('researcher');
    expect(upserted).toContain('writer');
    expect(upserted).toContain('analyst');
  });

  test('is idempotent — does not error when upsertSeed returns false', async () => {
    const mockStore = {
      upsertSeed: mock(() => false), // already exists
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of AgentStoreInterface
    } as any;
    // biome-ignore lint/suspicious/noExplicitAny: test mock — AgentPool not needed for seed logic
    const mockPool = {} as any;

    await expect(runSeeds(mockPool, mockStore)).resolves.toBeUndefined();
  });

  test('handles individual seed failures gracefully', async () => {
    let callCount = 0;
    const mockStore = {
      upsertSeed: mock(() => {
        callCount++;
        if (callCount === 2) throw new Error('DB write failed');
        return true;
      }),
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of AgentStoreInterface
    } as any;
    // biome-ignore lint/suspicious/noExplicitAny: test mock — AgentPool not needed for seed logic
    const mockPool = {} as any;

    // Should not throw — errors are caught per-seed
    await expect(runSeeds(mockPool, mockStore)).resolves.toBeUndefined();
    // Should have attempted all seeds despite one failure
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  test('seed agents have required fields', async () => {
    const agents: AgentDefinition[] = [];
    const mockStore = {
      upsertSeed: mock((agent: AgentDefinition) => {
        agents.push(agent);
        return true;
      }),
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of AgentStoreInterface
    } as any;

    // biome-ignore lint/suspicious/noExplicitAny: test mock — AgentPool not needed for seed logic
    await runSeeds({} as any, mockStore);

    for (const agent of agents) {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.role).toBeDefined();
      expect(agent.systemPrompt).toBeDefined();
      expect(agent.systemPrompt).toContain('AI orchestration platform');
      expect(agent.createdBy).toBe('seed');
      expect(agent.persistent).toBe(true);
    }
  });
});

describe('runCronSeeds', () => {
  test('creates cron when none exists', async () => {
    let created = false;
    const mockCronManager = {
      list: () => [],
      create: mock(async () => {
        created = true;
      }),
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of CronManager
    } as any;

    await runCronSeeds(mockCronManager);
    expect(created).toBe(true);
    expect(mockCronManager.create).toHaveBeenCalledTimes(1);
  });

  test('skips when cron seed already exists', async () => {
    const mockCronManager = {
      list: () => [{ name: 'Hourly Exchange Rate Report' }],
      create: mock(async () => {}),
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of CronManager
    } as any;

    await runCronSeeds(mockCronManager);
    expect(mockCronManager.create).not.toHaveBeenCalled();
  });

  test('handles creation failure gracefully', async () => {
    const mockCronManager = {
      list: () => [],
      create: mock(async () => {
        throw new Error('cron creation failed');
      }),
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of CronManager
    } as any;

    // Should not throw
    await expect(runCronSeeds(mockCronManager)).resolves.toBeUndefined();
  });

  test('cron seed targets exchange-rate-monitor agent', async () => {
    let createPayload: Record<string, unknown> | undefined;
    const mockCronManager = {
      list: () => [],
      create: mock(async (payload: Record<string, unknown>) => {
        createPayload = payload;
      }),
      // biome-ignore lint/suspicious/noExplicitAny: test mock — partial implementation of CronManager
    } as any;

    await runCronSeeds(mockCronManager);
    const workflow = createPayload?.workflow as { steps: { agentId: string }[] };
    expect(workflow.steps[0].agentId).toBe('exchange-rate-monitor');
    expect(createPayload?.schedule).toBe('0 * * * *');
    expect(createPayload?.enabled).toBe(true);
  });
});
