import { describe, expect, mock, test } from 'bun:test';
import {
  type CronManagerLike,
  executeSystemActions,
  formatActionResults,
  type SystemActionResult,
} from '../src/system-action-executor.ts';
import type { ParsedSystemAction } from '../src/system-action-parser.ts';

// Minimal mock conductor
function createMockConductor() {
  return {
    createAgent: mock(async (params: { name: string; role: string; systemPrompt: string }) => ({
      id: 'new-agent-1',
      name: params.name,
      role: params.role,
      status: 'idle',
      owner: 'conductor',
      persistent: false,
      createdAt: new Date().toISOString(),
    })),
    searchMemory: mock(async (_query: string, _limit: number) => ({
      entries: [{ content: 'Found result', id: 'mem-1' }],
      totalCount: 1,
    })),
  };
}

function createMockCronManager(): CronManagerLike {
  return {
    create: mock(
      async (params: {
        name: string;
        schedule: string;
        workflow: { steps: Array<{ agentId: string; task: string }>; output: string };
      }) => ({
        id: 'cron-1',
        name: params.name,
      }),
    ),
  };
}

describe('executeSystemActions', () => {
  test('executes create_agent action', async () => {
    const conductor = createMockConductor();
    const actions: ParsedSystemAction[] = [
      {
        type: 'create_agent',
        attributes: { name: 'Helper', role: 'assistant', systemPrompt: 'Help users' },
      },
    ];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.type).toBe('create_agent');
    expect((results[0]?.data as { id: string }).id).toBe('new-agent-1');
    expect(conductor.createAgent).toHaveBeenCalled();
  });

  test('fails create_agent with missing attributes', async () => {
    const conductor = createMockConductor();
    const actions: ParsedSystemAction[] = [{ type: 'create_agent', attributes: { name: 'Bot' } }];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('Missing required attributes');
  });

  test('executes search_memory action', async () => {
    const conductor = createMockConductor();
    const actions: ParsedSystemAction[] = [
      { type: 'search_memory', attributes: { query: 'test query', limit: '3' } },
    ];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.type).toBe('search_memory');
    expect(conductor.searchMemory).toHaveBeenCalledWith('test query', 3);
  });

  test('fails search_memory with missing query', async () => {
    const conductor = createMockConductor();
    const actions: ParsedSystemAction[] = [{ type: 'search_memory', attributes: {} }];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('Missing required attribute: query');
  });

  test('executes create_cron action', async () => {
    const conductor = createMockConductor();
    const cronManager = createMockCronManager();
    const actions: ParsedSystemAction[] = [
      {
        type: 'create_cron',
        attributes: {
          name: 'Daily Report',
          schedule: '0 9 * * *',
          agentId: 'reporter',
          task: 'Generate daily report',
        },
      },
    ];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
      cronManager,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.type).toBe('create_cron');
    expect(cronManager.create).toHaveBeenCalled();
  });

  test('fails create_cron with missing attributes', async () => {
    const conductor = createMockConductor();
    const cronManager = createMockCronManager();
    const actions: ParsedSystemAction[] = [{ type: 'create_cron', attributes: { name: 'Test' } }];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
      cronManager,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('Missing required attributes');
  });

  test('fails create_cron when CronManager is unavailable', async () => {
    const conductor = createMockConductor();
    const actions: ParsedSystemAction[] = [
      {
        type: 'create_cron',
        attributes: {
          name: 'Test',
          schedule: '0 * * * *',
          agentId: 'a1',
          task: 'Do something',
        },
      },
    ];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('CronManager is not available');
  });

  test('returns error for unknown action type', async () => {
    const conductor = createMockConductor();
    const actions: ParsedSystemAction[] = [{ type: 'unknown_action', attributes: {} }];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain('Unknown action type');
  });

  test('handles conductor errors gracefully', async () => {
    const conductor = createMockConductor();
    conductor.createAgent = mock(async () => {
      throw new Error('Pool full');
    });
    const actions: ParsedSystemAction[] = [
      {
        type: 'create_agent',
        attributes: { name: 'Bot', role: 'test', systemPrompt: 'test' },
      },
    ];

    const results = await executeSystemActions(actions, {
      conductor: conductor as never,
    });

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toBe('Pool full');
  });
});

describe('formatActionResults', () => {
  test('returns empty string for no results', () => {
    expect(formatActionResults([])).toBe('');
  });

  test('formats successful result', () => {
    const results: SystemActionResult[] = [
      { type: 'create_agent', success: true, data: { id: 'a1', name: 'Bot' } },
    ];
    const formatted = formatActionResults(results);
    expect(formatted).toContain('<system-action-results>');
    expect(formatted).toContain('success="true"');
    expect(formatted).toContain('</system-action-results>');
  });

  test('formats failed result', () => {
    const results: SystemActionResult[] = [
      { type: 'search_memory', success: false, error: 'No results' },
    ];
    const formatted = formatActionResults(results);
    expect(formatted).toContain('success="false"');
    expect(formatted).toContain('error="No results"');
  });
});
