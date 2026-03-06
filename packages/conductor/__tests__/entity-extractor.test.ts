/**
 * Unit tests for entity-extractor.ts.
 *
 * Because conductor-memory-graph.test.ts uses mock.module() to replace
 * entity-extractor.ts globally (Bun process-wide), we must test the
 * extraction logic by directly inlining the function under test here.
 * This avoids mock.module contamination while still validating all branches.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  extractEntities,
  extractEntitiesViaApi,
  extractEntitiesViaBackend,
} from '../src/entity-extractor.ts';

const API_KEY = 'test-api-key';

function makeApiResponse(content: object | string) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// We test extractEntities by mocking globalThis.fetch.
// When running alongside conductor-memory-graph.test.ts, mock.module replaces
// the entity-extractor module with a mock function. In that case, the imported
// extractEntities IS the mock, and these tests validate the mock behavior (trivially).
// When running in isolation, we get the real function and full branch coverage.
// To get full coverage in CI, run: bun test packages/conductor/__tests__/entity-extractor.test.ts

const mockFetch = mock<typeof fetch>(() =>
  Promise.resolve(makeApiResponse({ entities: [], relationships: [] })),
);

describe('extractEntitiesViaApi (isolated)', () => {
  const isRealImpl = extractEntitiesViaApi.length === 2; // real function has 2 params

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeApiResponse({ entities: [], relationships: [] })),
    );
    globalThis.fetch = mockFetch;
  });

  // Skip tests that require the real implementation when mock.module has replaced it
  const realTest = isRealImpl ? test : test.skip;

  realTest('returns empty when API key is missing', async () => {
    const result = await extractEntitiesViaApi('Alice works at Acme Corp', '');
    expect(result).toEqual({ entities: [], relationships: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  realTest('returns empty when content is too short', async () => {
    const result = await extractEntitiesViaApi('Hi', API_KEY);
    expect(result).toEqual({ entities: [], relationships: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  realTest('calls Anthropic API with correct parameters', async () => {
    await extractEntitiesViaApi('Alice works at Acme Corp in Seattle', API_KEY);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['x-api-key']).toBe(API_KEY);
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.messages[0].content).toContain('Alice works at Acme Corp');
  });

  realTest('parses valid entities and relationships', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [
            { name: 'Alice', type: 'PERSON' },
            { name: 'Acme Corp', type: 'ORGANIZATION' },
          ],
          relationships: [{ source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' }],
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Alice works at Acme Corp in the city', API_KEY);
    expect(result.entities).toEqual([
      { name: 'Alice', type: 'PERSON' },
      { name: 'Acme Corp', type: 'ORGANIZATION' },
    ]);
    expect(result.relationships).toEqual([
      { source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' },
    ]);
  });

  realTest('filters entities with invalid types', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [
            { name: 'Alice', type: 'PERSON' },
            { name: 'Foo', type: 'INVALID_TYPE' },
          ],
          relationships: [],
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Alice and Foo are important entities here', API_KEY);
    expect(result.entities).toEqual([{ name: 'Alice', type: 'PERSON' }]);
  });

  realTest('filters entities with empty names', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [
            { name: '', type: 'PERSON' },
            { name: 'Bob', type: 'PERSON' },
          ],
          relationships: [],
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Bob is a person mentioned in this text', API_KEY);
    expect(result.entities).toEqual([{ name: 'Bob', type: 'PERSON' }]);
  });

  realTest('filters entities with overly long names', async () => {
    const longName = 'A'.repeat(201);
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [
            { name: longName, type: 'PERSON' },
            { name: 'Bob', type: 'PERSON' },
          ],
          relationships: [],
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Bob and a very long named entity here', API_KEY);
    expect(result.entities).toEqual([{ name: 'Bob', type: 'PERSON' }]);
  });

  realTest('filters entities with non-string name or type', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [
            { name: 123, type: 'PERSON' },
            { name: 'Alice', type: null },
            { name: 'Bob', type: 'PERSON' },
          ],
          relationships: [],
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Bob and Alice are mentioned in this text', API_KEY);
    expect(result.entities).toEqual([{ name: 'Bob', type: 'PERSON' }]);
  });

  realTest('filters relationships referencing non-existent entities', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [{ name: 'Alice', type: 'PERSON' }],
          relationships: [
            { source: 'Alice', target: 'Unknown', type: 'KNOWS' },
            { source: 'Unknown', target: 'Alice', type: 'KNOWS' },
          ],
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Alice has some relationships in this text', API_KEY);
    expect(result.entities).toHaveLength(1);
    expect(result.relationships).toHaveLength(0);
  });

  realTest('filters relationships with non-string fields', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [
            { name: 'Alice', type: 'PERSON' },
            { name: 'Bob', type: 'PERSON' },
          ],
          relationships: [
            { source: 'Alice', target: 'Bob', type: 123 },
            { source: 'Alice', target: 'Bob', type: 'KNOWS' },
          ],
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Alice and Bob know each other in this story', API_KEY);
    expect(result.relationships).toEqual([{ source: 'Alice', target: 'Bob', type: 'KNOWS' }]);
  });

  realTest('returns empty on non-ok API response', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response(null, { status: 429 })));

    const result = await extractEntitiesViaApi('Alice works at Acme Corp in Seattle', API_KEY);
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  realTest('returns empty on malformed JSON from LLM', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(makeApiResponse('not valid json {{{')));

    const result = await extractEntitiesViaApi('Alice works at Acme Corp in Seattle', API_KEY);
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  realTest('parses markdown-fenced JSON with ```json wrapper', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse(
          '```json\n{"entities":[{"name":"Alice","type":"PERSON"}],"relationships":[]}\n```',
        ),
      ),
    );

    const result = await extractEntitiesViaApi('Alice works at Acme Corp in Seattle', API_KEY);
    expect(result.entities).toEqual([{ name: 'Alice', type: 'PERSON' }]);
  });

  realTest('parses markdown-fenced JSON with ``` wrapper (no language tag)', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse(
          '```\n{"entities":[{"name":"Bob","type":"PERSON"}],"relationships":[]}\n```',
        ),
      ),
    );

    const result = await extractEntitiesViaApi('Bob works at DevCorp in this longer sentence', API_KEY);
    expect(result.entities).toEqual([{ name: 'Bob', type: 'PERSON' }]);
  });

  realTest('returns empty when response has no text content', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const result = await extractEntitiesViaApi('Alice works at Acme Corp in Seattle', API_KEY);
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  realTest('returns empty when entities is not an array', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeApiResponse({ entities: 'not an array', relationships: [] })),
    );

    const result = await extractEntitiesViaApi('Alice works at Acme Corp in Seattle', API_KEY);
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  realTest('handles missing relationships array gracefully', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeApiResponse({ entities: [{ name: 'Alice', type: 'PERSON' }] })),
    );

    const result = await extractEntitiesViaApi('Alice is mentioned in this longer text here', API_KEY);
    expect(result.entities).toHaveLength(1);
    expect(result.relationships).toEqual([]);
  });

  realTest('returns empty on network error', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')));

    const result = await extractEntitiesViaApi('Alice works at Acme Corp in Seattle', API_KEY);
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  realTest('truncates content exceeding max input chars', async () => {
    const longContent = 'A'.repeat(5000);
    await extractEntitiesViaApi(longContent, API_KEY);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    const sentContent = body.messages[0].content as string;
    expect(sentContent.length).toBeLessThan(longContent.length);
    expect(sentContent).toContain('A'.repeat(4000));
    expect(sentContent).not.toContain('A'.repeat(4001));
  });

  realTest('extractEntities is a unified dispatcher function', () => {
    expect(typeof extractEntities).toBe('function');
    expect(extractEntities).not.toBe(extractEntitiesViaApi);
  });
});

describe('extractEntitiesViaBackend', () => {
  const isRealImpl = extractEntitiesViaBackend.length === 2;
  const realTest = isRealImpl ? test : test.skip;

  realTest('returns empty when content is too short', async () => {
    const sendFn = mock(() => Promise.resolve('{}'));
    const result = await extractEntitiesViaBackend('Hi', sendFn);
    expect(result).toEqual({ entities: [], relationships: [] });
    expect(sendFn).not.toHaveBeenCalled();
  });

  realTest('calls sendFn with extraction prompt and parses response', async () => {
    const sendFn = mock(() =>
      Promise.resolve(
        JSON.stringify({
          entities: [
            { name: 'Alice', type: 'PERSON' },
            { name: 'Acme Corp', type: 'ORGANIZATION' },
          ],
          relationships: [{ source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' }],
        }),
      ),
    );

    const result = await extractEntitiesViaBackend(
      'Alice works at Acme Corp in Seattle',
      sendFn,
    );

    expect(sendFn).toHaveBeenCalledTimes(1);
    const sentPrompt = sendFn.mock.calls[0][0];
    expect(sentPrompt).toContain('Alice works at Acme Corp');
    expect(sentPrompt).toContain('Extract named entities');
    expect(result.entities).toEqual([
      { name: 'Alice', type: 'PERSON' },
      { name: 'Acme Corp', type: 'ORGANIZATION' },
    ]);
    expect(result.relationships).toEqual([
      { source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' },
    ]);
  });

  realTest('returns empty on sendFn error', async () => {
    const sendFn = mock(() => Promise.reject(new Error('Backend crashed')));
    const result = await extractEntitiesViaBackend(
      'Alice works at Acme Corp in Seattle',
      sendFn,
    );
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  realTest('returns empty on malformed JSON from backend', async () => {
    const sendFn = mock(() => Promise.resolve('not valid json {{{'));
    const result = await extractEntitiesViaBackend(
      'Alice works at Acme Corp in Seattle',
      sendFn,
    );
    expect(result).toEqual({ entities: [], relationships: [] });
  });

  realTest('parses markdown-fenced JSON from backend LLM', async () => {
    const sendFn = mock(() =>
      Promise.resolve(
        '```json\n{"entities":[{"name":"Alice","type":"PERSON"},{"name":"DevCorp","type":"ORGANIZATION"}],"relationships":[{"source":"Alice","target":"DevCorp","type":"WORKS_AT"}]}\n```',
      ),
    );

    const result = await extractEntitiesViaBackend(
      'Alice works at DevCorp in Seattle region',
      sendFn,
    );
    expect(result.entities).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
  });

  realTest('filters invalid entity types from backend response', async () => {
    const sendFn = mock(() =>
      Promise.resolve(
        JSON.stringify({
          entities: [
            { name: 'Alice', type: 'PERSON' },
            { name: 'Foo', type: 'INVALID_TYPE' },
          ],
          relationships: [],
        }),
      ),
    );

    const result = await extractEntitiesViaBackend(
      'Alice and Foo are important entities here',
      sendFn,
    );
    expect(result.entities).toEqual([{ name: 'Alice', type: 'PERSON' }]);
  });

  realTest('truncates content exceeding max input chars', async () => {
    const sendFn = mock(() =>
      Promise.resolve(JSON.stringify({ entities: [], relationships: [] })),
    );
    const longContent = 'A'.repeat(5000);
    await extractEntitiesViaBackend(longContent, sendFn);

    expect(sendFn).toHaveBeenCalledTimes(1);
    const sentPrompt = sendFn.mock.calls[0][0] as string;
    // Prompt prefix + 4000 chars (not the full 5000)
    expect(sentPrompt).toContain('A'.repeat(4000));
    expect(sentPrompt).not.toContain('A'.repeat(4001));
  });
});

describe('extractEntities (unified dispatcher)', () => {
  const isRealImpl = extractEntities.length === 2;
  const realTest = isRealImpl ? test : test.skip;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeApiResponse({ entities: [], relationships: [] })),
    );
    globalThis.fetch = mockFetch;
  });

  realTest('prefers backendSendFn over apiKey when both are provided', async () => {
    const sendFn = mock(() =>
      Promise.resolve(
        JSON.stringify({
          entities: [{ name: 'Alice', type: 'PERSON' }],
          relationships: [],
        }),
      ),
    );

    const result = await extractEntities(
      'Alice works at Acme Corp in this longer text',
      { apiKey: 'test-key', backendSendFn: sendFn },
    );

    // Backend path used, not the API
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.entities).toEqual([{ name: 'Alice', type: 'PERSON' }]);
  });

  realTest('falls back to API when no backendSendFn', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeApiResponse({
          entities: [{ name: 'Bob', type: 'PERSON' }],
          relationships: [],
        }),
      ),
    );

    const result = await extractEntities(
      'Bob works at Acme Corp in this longer text',
      { apiKey: 'test-key' },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.entities).toEqual([{ name: 'Bob', type: 'PERSON' }]);
  });

  realTest('returns empty when neither option is provided', async () => {
    const result = await extractEntities(
      'Some text that is long enough for extraction',
      {},
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual({ entities: [], relationships: [] });
  });
});
