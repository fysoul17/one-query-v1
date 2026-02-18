import { describe, expect, test } from 'bun:test';
import type { StreamEvent } from '../src/backends/types.ts';

/** Collect all events from an async generator into an array. */
async function collectEvents(
  gen: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe('StreamEvent type contract', () => {
  test('chunk event has type "chunk" and content string', () => {
    const event: StreamEvent = { type: 'chunk', content: 'Hello' };
    expect(event.type).toBe('chunk');
    expect(event.content).toBe('Hello');
  });

  test('complete event has type "complete"', () => {
    const event: StreamEvent = { type: 'complete' };
    expect(event.type).toBe('complete');
  });

  test('complete event may include final content', () => {
    const event: StreamEvent = { type: 'complete', content: 'Final answer' };
    expect(event.type).toBe('complete');
    expect(event.content).toBe('Final answer');
  });

  test('error event has type "error" and error string', () => {
    const event: StreamEvent = { type: 'error', error: 'Something broke' };
    expect(event.type).toBe('error');
    expect(event.error).toBe('Something broke');
  });

  test('discriminated union covers all event types', () => {
    const events: StreamEvent[] = [
      { type: 'chunk', content: 'data' },
      { type: 'complete' },
      { type: 'error', error: 'fail' },
    ];

    const types = events.map((e) => e.type);
    expect(types).toEqual(['chunk', 'complete', 'error']);
  });
});

describe('BackendProcess.sendStreaming()', () => {
  // These tests use a mock streaming process to define the contract.
  // The real implementation will conform to these expectations.

  /** Mock streaming process that yields pre-configured events. */
  function createMockStreamingProcess(events: StreamEvent[]) {
    return {
      async *sendStreaming(
        _message: string,
        _signal?: AbortSignal,
      ): AsyncGenerator<StreamEvent> {
        for (const event of events) {
          if (_signal?.aborted) {
            yield { type: 'error' as const, error: 'Aborted' };
            return;
          }
          yield event;
        }
      },
    };
  }

  /** Mock streaming process with async delay between events. */
  function createDelayedStreamingProcess(events: StreamEvent[], delayMs: number) {
    return {
      async *sendStreaming(
        _message: string,
        signal?: AbortSignal,
      ): AsyncGenerator<StreamEvent> {
        for (const event of events) {
          if (signal?.aborted) {
            yield { type: 'error' as const, error: 'Aborted' };
            return;
          }
          await new Promise((r) => setTimeout(r, delayMs));
          yield event;
        }
      },
    };
  }

  test('yields chunk events with content', async () => {
    const proc = createMockStreamingProcess([
      { type: 'chunk', content: 'Hello' },
      { type: 'chunk', content: ' world' },
      { type: 'complete' },
    ]);

    const events = await collectEvents(proc.sendStreaming('test'));
    const chunks = events.filter((e) => e.type === 'chunk');

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' world');
  });

  test('yields complete event at end of stream', async () => {
    const proc = createMockStreamingProcess([
      { type: 'chunk', content: 'data' },
      { type: 'complete' },
    ]);

    const events = await collectEvents(proc.sendStreaming('test'));
    const last = events[events.length - 1];

    expect(last.type).toBe('complete');
  });

  test('yields error event on failure', async () => {
    const proc = createMockStreamingProcess([
      { type: 'chunk', content: 'partial' },
      { type: 'error', error: 'Backend crashed' },
    ]);

    const events = await collectEvents(proc.sendStreaming('test'));
    const errorEvents = events.filter((e) => e.type === 'error');

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error).toBe('Backend crashed');
  });

  test('complete content can be assembled from chunks', async () => {
    const proc = createMockStreamingProcess([
      { type: 'chunk', content: 'The ' },
      { type: 'chunk', content: 'quick ' },
      { type: 'chunk', content: 'brown ' },
      { type: 'chunk', content: 'fox' },
      { type: 'complete' },
    ]);

    const events = await collectEvents(proc.sendStreaming('test'));
    const fullContent = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.content)
      .join('');

    expect(fullContent).toBe('The quick brown fox');
  });

  test('stream with only complete event (empty response)', async () => {
    const proc = createMockStreamingProcess([{ type: 'complete' }]);

    const events = await collectEvents(proc.sendStreaming('test'));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('complete');
  });

  test('stream with error as first event', async () => {
    const proc = createMockStreamingProcess([
      { type: 'error', error: 'Connection refused' },
    ]);

    const events = await collectEvents(proc.sendStreaming('test'));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].error).toBe('Connection refused');
  });

  describe('abort support', () => {
    test('stream can be aborted with AbortSignal', async () => {
      const controller = new AbortController();

      const proc = createDelayedStreamingProcess(
        [
          { type: 'chunk', content: 'chunk1' },
          { type: 'chunk', content: 'chunk2' },
          { type: 'chunk', content: 'chunk3' },
          { type: 'complete' },
        ],
        20,
      );

      const events: StreamEvent[] = [];
      const gen = proc.sendStreaming('test', controller.signal);

      // Collect first event, then abort
      const first = await gen.next();
      if (!first.done) events.push(first.value);

      controller.abort();

      // Remaining events should include an abort error
      for await (const event of gen) {
        events.push(event);
      }

      const hasAbortError = events.some(
        (e) => e.type === 'error' && e.error === 'Aborted',
      );
      expect(hasAbortError).toBe(true);
    });

    test('aborted stream stops yielding new chunks', async () => {
      const controller = new AbortController();

      const proc = createDelayedStreamingProcess(
        [
          { type: 'chunk', content: 'a' },
          { type: 'chunk', content: 'b' },
          { type: 'chunk', content: 'c' },
          { type: 'chunk', content: 'd' },
          { type: 'complete' },
        ],
        15,
      );

      const events: StreamEvent[] = [];
      const gen = proc.sendStreaming('test', controller.signal);

      // Get first event
      const first = await gen.next();
      if (!first.done) events.push(first.value);

      // Abort immediately
      controller.abort();

      // Drain remaining
      for await (const event of gen) {
        events.push(event);
      }

      // Should have fewer events than the full stream
      const chunkCount = events.filter((e) => e.type === 'chunk').length;
      expect(chunkCount).toBeLessThan(4);
    });

    test('pre-aborted signal yields error immediately', async () => {
      const controller = new AbortController();
      controller.abort(); // Already aborted

      const proc = createMockStreamingProcess([
        { type: 'chunk', content: 'should not appear' },
        { type: 'complete' },
      ]);

      const events = await collectEvents(
        proc.sendStreaming('test', controller.signal),
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].error).toBe('Aborted');
    });
  });

  describe('security: error sanitization', () => {
    test('error events should not contain file system paths', async () => {
      const proc = createMockStreamingProcess([
        { type: 'error', error: 'Backend failed' },
      ]);

      const events = await collectEvents(proc.sendStreaming('test'));
      const errorEvent = events.find((e) => e.type === 'error');

      expect(errorEvent).toBeDefined();
      // Error messages must not leak internal file paths
      expect(errorEvent!.error).not.toMatch(/\/Users\//);
      expect(errorEvent!.error).not.toMatch(/\/home\//);
      expect(errorEvent!.error).not.toMatch(/\/opt\//);
      expect(errorEvent!.error).not.toMatch(/node_modules/);
    });

    test('error events should not contain stack traces', async () => {
      // Simulate a raw error that includes a stack trace
      const rawError = new Error('internal failure');
      // The streaming contract should sanitize errors before yielding
      const sanitizedError = rawError.message; // Implementation should use .message, not .stack

      const proc = createMockStreamingProcess([
        { type: 'error', error: sanitizedError },
      ]);

      const events = await collectEvents(proc.sendStreaming('test'));
      const errorEvent = events.find((e) => e.type === 'error');

      expect(errorEvent!.error).not.toContain('at ');
      expect(errorEvent!.error).not.toContain('.ts:');
      expect(errorEvent!.error).not.toContain('.js:');
    });

    test('error event contains only a user-safe message', async () => {
      const proc = createMockStreamingProcess([
        { type: 'error', error: 'Backend process exited unexpectedly' },
      ]);

      const events = await collectEvents(proc.sendStreaming('test'));
      const errorEvent = events.find((e) => e.type === 'error');

      expect(typeof errorEvent!.error).toBe('string');
      expect(errorEvent!.error!.length).toBeGreaterThan(0);
      expect(errorEvent!.error!.length).toBeLessThan(500); // Bounded error message
    });
  });

  describe('async iteration protocol', () => {
    test('sendStreaming returns an AsyncGenerator', () => {
      const proc = createMockStreamingProcess([{ type: 'complete' }]);
      const gen = proc.sendStreaming('test');

      // AsyncGenerator should have next, return, and throw methods
      expect(typeof gen.next).toBe('function');
      expect(typeof gen.return).toBe('function');
      expect(typeof gen.throw).toBe('function');
    });

    test('supports for-await-of iteration', async () => {
      const proc = createMockStreamingProcess([
        { type: 'chunk', content: 'x' },
        { type: 'complete' },
      ]);

      const types: string[] = [];
      for await (const event of proc.sendStreaming('test')) {
        types.push(event.type);
      }

      expect(types).toEqual(['chunk', 'complete']);
    });

    test('generator can be manually iterated with next()', async () => {
      const proc = createMockStreamingProcess([
        { type: 'chunk', content: 'first' },
        { type: 'chunk', content: 'second' },
        { type: 'complete' },
      ]);

      const gen = proc.sendStreaming('test');

      const r1 = await gen.next();
      expect(r1.done).toBe(false);
      expect(r1.value.type).toBe('chunk');
      expect(r1.value.content).toBe('first');

      const r2 = await gen.next();
      expect(r2.done).toBe(false);
      expect(r2.value.type).toBe('chunk');
      expect(r2.value.content).toBe('second');

      const r3 = await gen.next();
      expect(r3.done).toBe(false);
      expect(r3.value.type).toBe('complete');

      const r4 = await gen.next();
      expect(r4.done).toBe(true);
    });

    test('generator can be terminated early with return()', async () => {
      const proc = createMockStreamingProcess([
        { type: 'chunk', content: 'a' },
        { type: 'chunk', content: 'b' },
        { type: 'chunk', content: 'c' },
        { type: 'complete' },
      ]);

      const gen = proc.sendStreaming('test');

      const r1 = await gen.next();
      expect(r1.value.type).toBe('chunk');

      // Terminate early
      const ret = await gen.return(undefined as never);
      expect(ret.done).toBe(true);

      // Subsequent next() should return done
      const after = await gen.next();
      expect(after.done).toBe(true);
    });
  });
});
