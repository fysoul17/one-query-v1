import { describe, expect, test } from 'bun:test';
import {
  accumulateAgentStep,
  buildStepMetadata,
  MAX_PERSISTED_INPUT_BYTES,
  type StreamState,
} from '../src/step-metadata.ts';

/** Create a fresh StreamState for testing. */
function createStreamState(): StreamState {
  return {
    accumulatedContent: '',
    completeSent: false,
    errorSent: false,
    pipelinePhases: [],
    agentActivities: new Map(),
    toolToAgent: new Map(),
  };
}

/** Get an agent from state, failing the test if not found. */
function getAgent(state: StreamState, agentId: string) {
  const agent = state.agentActivities.get(agentId);
  expect(agent).toBeDefined();
  // biome-ignore lint/style/noNonNullAssertion: guarded by expect above
  return agent!;
}

/** Get the first tool call from an agent, failing the test if not found. */
function getFirstTool(state: StreamState, agentId: string) {
  const agent = getAgent(state, agentId);
  expect(agent.toolCalls.length).toBeGreaterThan(0);
  // biome-ignore lint/style/noNonNullAssertion: guarded by expect above
  return agent.toolCalls[0]!;
}

describe('accumulateAgentStep', () => {
  test('tool_start creates agent and pushes tool call', () => {
    const state = createStreamState();
    accumulateAgentStep(
      state,
      { type: 'tool_start', toolId: 't1', toolName: 'search' },
      'agent-1',
      'Search Agent',
    );

    expect(state.agentActivities.size).toBe(1);
    const agent = getAgent(state, 'agent-1');
    expect(agent.agentId).toBe('agent-1');
    expect(agent.agentName).toBe('Search Agent');
    expect(agent.toolCalls).toHaveLength(1);
    const tool = getFirstTool(state, 'agent-1');
    expect(tool.toolId).toBe('t1');
    expect(tool.toolName).toBe('search');
    expect(tool.accumulatedInput).toBe('');
    expect(tool.status).toBe('streaming');
    expect(tool.startedAt).toBeGreaterThan(0);
    expect(state.toolToAgent.get('t1')).toBe('agent-1');
  });

  test('tool_start defaults toolName to unknown when missing', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1' }, 'agent-1');

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.toolName).toBe('unknown');
  });

  test('tool_start with missing toolId is a no-op', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start' }, 'agent-1');

    expect(state.agentActivities.size).toBe(0);
    expect(state.toolToAgent.size).toBe(0);
  });

  test('tool_input appends inputDelta to tool accumulatedInput', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'read' }, 'agent-1');
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 't1', inputDelta: 'hello ' },
      'agent-1',
    );
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 't1', inputDelta: 'world' },
      'agent-1',
    );

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.accumulatedInput).toBe('hello world');
  });

  test('tool_input with missing toolId is a no-op', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'x' }, 'agent-1');
    accumulateAgentStep(state, { type: 'tool_input', inputDelta: 'data' }, 'agent-1');

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.accumulatedInput).toBe('');
  });

  test('tool_input with missing inputDelta is a no-op', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'x' }, 'agent-1');
    accumulateAgentStep(state, { type: 'tool_input', toolId: 't1' }, 'agent-1');

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.accumulatedInput).toBe('');
  });

  test('tool_input with unknown toolId is a no-op', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'x' }, 'agent-1');
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 'unknown-tool', inputDelta: 'data' },
      'agent-1',
    );

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.accumulatedInput).toBe('');
  });

  test('tool_input truncates at MAX_PERSISTED_INPUT_BYTES', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'write' }, 'agent-1');

    // Send a single large chunk that exceeds the cap
    const largeInput = 'x'.repeat(MAX_PERSISTED_INPUT_BYTES + 500);
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 't1', inputDelta: largeInput },
      'agent-1',
    );

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.accumulatedInput).toStartWith('x'.repeat(100));
    expect(tool.accumulatedInput).toEndWith('\n[truncated]');
    expect(tool.accumulatedInput.length).toBeLessThanOrEqual(MAX_PERSISTED_INPUT_BYTES + 20); // cap + marker
  });

  test('tool_input stops accumulating once already at cap', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'write' }, 'agent-1');

    // Fill to exactly the cap
    const fillInput = 'a'.repeat(MAX_PERSISTED_INPUT_BYTES + 1);
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 't1', inputDelta: fillInput },
      'agent-1',
    );

    const tool = getFirstTool(state, 'agent-1');
    const lengthAfterFirst = tool.accumulatedInput.length;

    // Subsequent inputs should be ignored since we're already past cap
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 't1', inputDelta: 'more data' },
      'agent-1',
    );
    expect(tool.accumulatedInput.length).toBe(lengthAfterFirst);
  });

  test('tool_complete marks tool as complete with duration', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'search' }, 'agent-1');
    accumulateAgentStep(state, { type: 'tool_complete', toolId: 't1', durationMs: 150 }, 'agent-1');

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.status).toBe('complete');
    expect(tool.durationMs).toBe(150);
    expect(tool.completedAt).toBeGreaterThan(0);
    // toolToAgent mapping should be cleaned up
    expect(state.toolToAgent.has('t1')).toBe(false);
  });

  test('tool_complete with missing toolId is a no-op', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'x' }, 'agent-1');
    accumulateAgentStep(state, { type: 'tool_complete' }, 'agent-1');

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.status).toBe('streaming');
  });

  test('tool_complete with unknown toolId is a no-op', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'tool_start', toolId: 't1', toolName: 'x' }, 'agent-1');
    accumulateAgentStep(
      state,
      { type: 'tool_complete', toolId: 'unknown-tool', durationMs: 100 },
      'agent-1',
    );

    const tool = getFirstTool(state, 'agent-1');
    expect(tool.status).toBe('streaming');
  });

  test('thinking event creates agent and pushes thinking block', () => {
    const state = createStreamState();
    accumulateAgentStep(
      state,
      { type: 'thinking', content: 'Analyzing the query...' },
      'agent-1',
      'Analyst',
    );

    const agent = getAgent(state, 'agent-1');
    expect(agent.agentName).toBe('Analyst');
    expect(agent.thinkingBlocks).toHaveLength(1);
    expect(agent.thinkingBlocks[0]?.content).toBe('Analyzing the query...');
    expect(agent.thinkingBlocks[0]?.timestamp).toBeGreaterThan(0);
  });

  test('thinking event defaults content to empty string', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'thinking' }, 'agent-1');

    const agent = getAgent(state, 'agent-1');
    expect(agent.thinkingBlocks[0]?.content).toBe('');
  });

  test('getOrCreateAgent is idempotent — returns same agent on repeat calls', () => {
    const state = createStreamState();
    accumulateAgentStep(
      state,
      { type: 'tool_start', toolId: 't1', toolName: 'a' },
      'agent-1',
      'Agent One',
    );
    accumulateAgentStep(
      state,
      { type: 'tool_start', toolId: 't2', toolName: 'b' },
      'agent-1',
      'Agent One',
    );

    expect(state.agentActivities.size).toBe(1);
    const agent = getAgent(state, 'agent-1');
    expect(agent.toolCalls).toHaveLength(2);
  });

  test('multiple agents accumulate independently', () => {
    const state = createStreamState();
    accumulateAgentStep(
      state,
      { type: 'tool_start', toolId: 't1', toolName: 'search' },
      'agent-1',
      'Search',
    );
    accumulateAgentStep(
      state,
      { type: 'tool_start', toolId: 't2', toolName: 'write' },
      'agent-2',
      'Writer',
    );
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 't1', inputDelta: 'query' },
      'agent-1',
    );
    accumulateAgentStep(
      state,
      { type: 'tool_input', toolId: 't2', inputDelta: 'content' },
      'agent-2',
    );

    expect(state.agentActivities.size).toBe(2);
    expect(state.agentActivities.get('agent-1')?.toolCalls[0]?.accumulatedInput).toBe('query');
    expect(state.agentActivities.get('agent-2')?.toolCalls[0]?.accumulatedInput).toBe('content');
  });

  test('unknown event type is a no-op', () => {
    const state = createStreamState();
    accumulateAgentStep(state, { type: 'unknown_event' }, 'agent-1');

    expect(state.agentActivities.size).toBe(0);
  });
});

describe('buildStepMetadata', () => {
  test('returns undefined when state is empty', () => {
    const state = createStreamState();
    expect(buildStepMetadata(state)).toBeUndefined();
  });

  test('returns pipeline-only metadata when no agent activities', () => {
    const state = createStreamState();
    state.pipelinePhases.push({ phase: 'queued', message: 'Message queued...', timestamp: 1000 });
    state.pipelinePhases.push({
      phase: 'responding',
      message: 'Responding...',
      timestamp: 2000,
      durationMs: 500,
    });

    const metadata = buildStepMetadata(state);
    expect(metadata).toBeDefined();
    expect(metadata?.pipeline).toHaveLength(2);
    expect(metadata?.pipeline?.[0]?.phase).toBe('queued');
    expect(metadata?.pipeline?.[1]?.durationMs).toBe(500);
    expect(metadata?.activityFeed).toBeUndefined();
  });

  test('returns activityFeed-only metadata when no pipeline phases', () => {
    const state = createStreamState();
    state.agentActivities.set('agent-1', {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      toolCalls: [
        {
          toolId: 't1',
          toolName: 'search',
          accumulatedInput: 'q',
          status: 'complete',
          durationMs: 200,
          startedAt: 1000,
          completedAt: 1200,
        },
      ],
      thinkingBlocks: [{ content: 'thinking...', timestamp: 900 }],
    });

    const metadata = buildStepMetadata(state);
    expect(metadata).toBeDefined();
    expect(metadata?.pipeline).toBeUndefined();
    expect(metadata?.activityFeed).toBeDefined();
    expect(metadata?.activityFeed?.agents).toHaveLength(1);
    expect(metadata?.activityFeed?.totalSteps).toBe(2); // 1 tool + 1 thinking
    expect(metadata?.activityFeed?.totalDurationMs).toBe(200);
    expect(metadata?.activityFeed?.isActive).toBe(false);
  });

  test('returns both pipeline and activityFeed when both present', () => {
    const state = createStreamState();
    state.pipelinePhases.push({ phase: 'queued', message: 'Queued', timestamp: 1000 });
    state.agentActivities.set('agent-1', {
      agentId: 'agent-1',
      toolCalls: [
        {
          toolId: 't1',
          toolName: 'read',
          accumulatedInput: '',
          status: 'complete',
          durationMs: 100,
          startedAt: 1000,
        },
      ],
      thinkingBlocks: [],
    });

    const metadata = buildStepMetadata(state);
    expect(metadata).toBeDefined();
    expect(metadata?.pipeline).toHaveLength(1);
    expect(metadata?.activityFeed).toBeDefined();
    expect(metadata?.activityFeed?.totalSteps).toBe(1);
  });

  test('totalSteps sums tool calls and thinking blocks across all agents', () => {
    const state = createStreamState();
    state.agentActivities.set('agent-1', {
      agentId: 'agent-1',
      toolCalls: [
        { toolId: 't1', toolName: 'a', accumulatedInput: '', status: 'complete', startedAt: 0 },
        { toolId: 't2', toolName: 'b', accumulatedInput: '', status: 'complete', startedAt: 0 },
      ],
      thinkingBlocks: [{ content: 'x', timestamp: 0 }],
    });
    state.agentActivities.set('agent-2', {
      agentId: 'agent-2',
      toolCalls: [
        { toolId: 't3', toolName: 'c', accumulatedInput: '', status: 'complete', startedAt: 0 },
      ],
      thinkingBlocks: [
        { content: 'y', timestamp: 0 },
        { content: 'z', timestamp: 0 },
      ],
    });

    const metadata = buildStepMetadata(state);
    expect(metadata?.activityFeed?.totalSteps).toBe(6); // 2+1 + 1+2
  });

  test('totalDurationMs sums tool call durations, treating undefined as 0', () => {
    const state = createStreamState();
    state.agentActivities.set('agent-1', {
      agentId: 'agent-1',
      toolCalls: [
        {
          toolId: 't1',
          toolName: 'a',
          accumulatedInput: '',
          status: 'complete',
          durationMs: 100,
          startedAt: 0,
        },
        { toolId: 't2', toolName: 'b', accumulatedInput: '', status: 'streaming', startedAt: 0 }, // no durationMs
        {
          toolId: 't3',
          toolName: 'c',
          accumulatedInput: '',
          status: 'complete',
          durationMs: 250,
          startedAt: 0,
        },
      ],
      thinkingBlocks: [],
    });

    const metadata = buildStepMetadata(state);
    expect(metadata?.activityFeed?.totalDurationMs).toBe(350);
  });

  test('isActive is always false in persisted metadata', () => {
    const state = createStreamState();
    state.agentActivities.set('agent-1', {
      agentId: 'agent-1',
      toolCalls: [
        { toolId: 't1', toolName: 'x', accumulatedInput: '', status: 'streaming', startedAt: 0 },
      ],
      thinkingBlocks: [],
    });

    const metadata = buildStepMetadata(state);
    expect(metadata?.activityFeed?.isActive).toBe(false);
  });

  test('metadata is JSON-serializable', () => {
    const state = createStreamState();
    state.pipelinePhases.push({ phase: 'queued', message: 'Queued', timestamp: Date.now() });
    state.agentActivities.set('agent-1', {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      toolCalls: [
        {
          toolId: 't1',
          toolName: 'search',
          accumulatedInput: '{"query":"test"}',
          status: 'complete',
          durationMs: 150,
          startedAt: 1000,
          completedAt: 1150,
        },
      ],
      thinkingBlocks: [{ content: 'Let me think...', timestamp: 900 }],
    });

    const metadata = buildStepMetadata(state);
    expect(metadata).toBeDefined();
    const json = JSON.stringify(metadata);
    const parsed = JSON.parse(json);

    expect(parsed.pipeline).toHaveLength(1);
    expect(parsed.activityFeed.agents).toHaveLength(1);
    expect(parsed.activityFeed.totalSteps).toBe(2);
    expect(parsed.activityFeed.isActive).toBe(false);
  });
});
