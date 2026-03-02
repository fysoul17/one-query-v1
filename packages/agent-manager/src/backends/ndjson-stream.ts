import type { StreamEvent } from '@autonomy/shared';
import { DEFAULTS } from '@autonomy/shared';

/**
 * Discriminated union for parsed NDJSON lines.
 * - 'json': Successfully parsed JSON object
 * - 'text': Unparseable line (raw text fallback)
 */
export type NDJSONLine =
  | { type: 'json'; data: Record<string, unknown> }
  | { type: 'text'; data: string };

/**
 * Async generator that reads NDJSON from a ReadableStream.
 * Handles chunk buffering, newline splitting, JSON parsing, and decoder flush.
 * Releases the reader lock automatically when iteration completes or the consumer breaks.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming parser requires sequential state handling
export async function* readNDJSONStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<NDJSONLine> {
  const decoder = new TextDecoder();
  let lineBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });

      let newlineIdx = lineBuffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = lineBuffer.slice(0, newlineIdx).trim();
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        newlineIdx = lineBuffer.indexOf('\n');

        if (!line) continue;

        try {
          yield { type: 'json', data: JSON.parse(line) as Record<string, unknown> };
        } catch {
          yield { type: 'text', data: line };
        }
      }
    }

    // Flush decoder remainder (partial multi-byte sequences)
    const decoderRemainder = decoder.decode();
    if (decoderRemainder) lineBuffer += decoderRemainder;

    // Yield remaining buffer (stream ended without trailing newline)
    const remaining = lineBuffer.trim();
    if (remaining) {
      try {
        yield { type: 'json', data: JSON.parse(remaining) as Record<string, unknown> };
      } catch {
        yield { type: 'text', data: remaining };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Common exit-code handling for CLI backend processes.
 * Yields an error or complete event based on exit code and output state.
 */
export function* finalizeProcess(
  exitCode: number,
  stderrText: string,
  hasContent: boolean,
): Generator<StreamEvent> {
  if (exitCode !== 0) {
    const stderr = stderrText.trim().slice(0, DEFAULTS.MAX_ERROR_PREVIEW_LENGTH);
    yield {
      type: 'error',
      error: stderr
        ? `Backend exited with code ${exitCode}: ${stderr}`
        : `Backend process exited with code ${exitCode}`,
    };
  } else if (!hasContent && stderrText.trim()) {
    yield {
      type: 'error',
      error: `Backend produced no output: ${stderrText.trim().slice(0, DEFAULTS.MAX_ERROR_PREVIEW_LENGTH)}`,
    };
  } else {
    yield { type: 'complete' };
  }
}
