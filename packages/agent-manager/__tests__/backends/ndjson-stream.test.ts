import { describe, expect, test } from 'bun:test';
import {
  finalizeProcess,
  type NDJSONLine,
  readNDJSONStream,
} from '../../src/backends/ndjson-stream.ts';

/** Create a ReadableStream from an array of string chunks. */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Collect all items from the async generator into an array. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<NDJSONLine[]> {
  const reader = stream.getReader();
  const result: NDJSONLine[] = [];
  for await (const line of readNDJSONStream(reader)) {
    result.push(line);
  }
  return result;
}

describe('readNDJSONStream', () => {
  test('parses single JSON line', async () => {
    const lines = await collect(streamFrom(['{"type":"init"}\n']));
    expect(lines).toEqual([{ type: 'json', data: { type: 'init' } }]);
  });

  test('parses multiple JSON lines in one chunk', async () => {
    const lines = await collect(streamFrom(['{"a":1}\n{"b":2}\n{"c":3}\n']));
    expect(lines).toEqual([
      { type: 'json', data: { a: 1 } },
      { type: 'json', data: { b: 2 } },
      { type: 'json', data: { c: 3 } },
    ]);
  });

  test('handles lines split across chunks', async () => {
    const lines = await collect(streamFrom(['{"typ', 'e":"m', 'essage"}\n']));
    expect(lines).toEqual([{ type: 'json', data: { type: 'message' } }]);
  });

  test('handles trailing content without newline', async () => {
    const lines = await collect(streamFrom(['{"last":true}']));
    expect(lines).toEqual([{ type: 'json', data: { last: true } }]);
  });

  test('yields text for unparseable lines', async () => {
    const lines = await collect(streamFrom(['not json\n']));
    expect(lines).toEqual([{ type: 'text', data: 'not json' }]);
  });

  test('handles mix of JSON and raw text', async () => {
    const lines = await collect(streamFrom(['{"ok":true}\nraw line\n{"more":1}\n']));
    expect(lines).toEqual([
      { type: 'json', data: { ok: true } },
      { type: 'text', data: 'raw line' },
      { type: 'json', data: { more: 1 } },
    ]);
  });

  test('skips empty lines', async () => {
    const lines = await collect(streamFrom(['{"a":1}\n\n\n{"b":2}\n']));
    expect(lines).toEqual([
      { type: 'json', data: { a: 1 } },
      { type: 'json', data: { b: 2 } },
    ]);
  });

  test('handles empty stream', async () => {
    const lines = await collect(streamFrom([]));
    expect(lines).toEqual([]);
  });

  test('handles whitespace-only stream', async () => {
    const lines = await collect(streamFrom(['  \n  \n']));
    expect(lines).toEqual([]);
  });

  test('releases reader lock when iteration completes', async () => {
    const stream = streamFrom(['{"a":1}\n']);
    const reader = stream.getReader();
    const lines: NDJSONLine[] = [];
    for await (const line of readNDJSONStream(reader)) {
      lines.push(line);
    }
    // Reader lock should be released — getting a new reader should not throw
    const newReader = stream.getReader();
    expect(newReader).toBeDefined();
    newReader.releaseLock();
  });

  test('releases reader lock when consumer breaks early', async () => {
    const stream = streamFrom(['{"a":1}\n{"b":2}\n{"c":3}\n']);
    const reader = stream.getReader();
    const lines: NDJSONLine[] = [];
    for await (const line of readNDJSONStream(reader)) {
      lines.push(line);
      if (lines.length === 1) break;
    }
    expect(lines).toHaveLength(1);
    // Reader lock should be released
    const newReader = stream.getReader();
    expect(newReader).toBeDefined();
    newReader.releaseLock();
  });

  test('handles rapid consecutive empty lines without hanging', async () => {
    // Regression test: ensures no infinite loop on consecutive empty lines
    const lines = await collect(streamFrom(['\n\n\n\n\n{"ok":true}\n\n\n']));
    expect(lines).toEqual([{ type: 'json', data: { ok: true } }]);
  });
});

describe('finalizeProcess', () => {
  test('yields error on non-zero exit code with stderr', () => {
    const events = [...finalizeProcess(1, 'something went wrong', true)];
    expect(events).toEqual([
      { type: 'error', error: 'Backend exited with code 1: something went wrong' },
    ]);
  });

  test('yields error on non-zero exit code without stderr', () => {
    const events = [...finalizeProcess(1, '', true)];
    expect(events).toEqual([{ type: 'error', error: 'Backend process exited with code 1' }]);
  });

  test('yields error on zero exit with no content but stderr', () => {
    const events = [...finalizeProcess(0, 'warning: something', false)];
    expect(events).toEqual([
      { type: 'error', error: 'Backend produced no output: warning: something' },
    ]);
  });

  test('yields complete on zero exit with content', () => {
    const events = [...finalizeProcess(0, '', true)];
    expect(events).toEqual([{ type: 'complete' }]);
  });

  test('yields complete on zero exit with no content and no stderr', () => {
    const events = [...finalizeProcess(0, '', false)];
    expect(events).toEqual([{ type: 'complete' }]);
  });

  test('truncates long stderr to 500 chars', () => {
    const longStderr = 'x'.repeat(1000);
    const events = [...finalizeProcess(1, longStderr, true)];
    expect(events[0]?.type).toBe('error');
    // 500 chars from stderr + prefix
    expect((events[0] as { error: string }).error.length).toBeLessThan(600);
  });
});
