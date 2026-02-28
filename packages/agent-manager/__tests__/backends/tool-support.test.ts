/**
 * Tool Support Tests — Verify that Codex, Gemini, and Ollama backends
 * correctly wire config.tools to their respective CLI flags or API parameters.
 *
 * Pattern: Mock Bun.spawn (or fetch for Ollama) to capture args without running real CLIs.
 * Follows the same pattern as claude-session.test.ts.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { AIBackend, BACKEND_CAPABILITIES } from '@autonomy/shared';
import { CodexBackend } from '../../src/backends/codex.ts';
import { GeminiBackend } from '../../src/backends/gemini.ts';
import { OllamaBackend } from '../../src/backends/ollama.ts';
import type { BackendSpawnConfig } from '../../src/backends/types.ts';

// ─── Codex Tool Support ────────────────────────────────────────────────

describe('CodexBackend tool support', () => {
  let backend: CodexBackend;
  let originalSpawn: typeof Bun.spawn;
  let capturedArgs: string[][] = [];

  beforeEach(() => {
    backend = new CodexBackend();
    capturedArgs = [];

    originalSpawn = Bun.spawn;
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = mock((...args: unknown[]) => {
      const cmd = args[0] as string[];
      capturedArgs.push(cmd);
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ type: 'message', role: 'assistant', content: 'ok' }) + '\n',
              ),
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
        exitCode: null,
        kill: () => {},
      };
    });
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  test('capabilities report customTools: true', () => {
    expect(backend.capabilities.customTools).toBe(true);
    expect(BACKEND_CAPABILITIES[AIBackend.CODEX].customTools).toBe(true);
  });

  test('includes --enable flags for each tool on first call', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'tool-agent',
      systemPrompt: 'Test',
      tools: ['shell', 'file_read', 'file_write'],
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    const args = capturedArgs[0] as string[];
    // Each tool should have its own --enable flag
    const enableIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === '--enable') acc.push(idx);
      return acc;
    }, []);
    expect(enableIndices).toHaveLength(3);
    expect(args[enableIndices[0] + 1]).toBe('shell');
    expect(args[enableIndices[1] + 1]).toBe('file_read');
    expect(args[enableIndices[2] + 1]).toBe('file_write');
  });

  test('omits --enable flags when tools array is empty', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'no-tools',
      systemPrompt: 'Test',
      tools: [],
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    const args = capturedArgs[0] as string[];
    expect(args).not.toContain('--enable');
  });

  test('omits --enable flags when tools is undefined', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'no-tools',
      systemPrompt: 'Test',
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    const args = capturedArgs[0] as string[];
    expect(args).not.toContain('--enable');
  });

  test('resume call omits --enable flags (tools only on first call)', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'resume-tool',
      systemPrompt: 'Test',
      tools: ['shell'],
    };

    // Override mock to return session_id so second call uses resume path
    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = mock((...args: unknown[]) => {
      const cmd = args[0] as string[];
      capturedArgs.push(cmd);
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  session_id: 'sess-codex-001',
                  type: 'message',
                  role: 'assistant',
                  content: 'ok',
                }) + '\n',
              ),
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
        exitCode: null,
        kill: () => {},
      };
    });

    const proc = await backend.spawn(config);
    await proc.send('First');
    await proc.send('Second');

    // First call has --enable
    expect(capturedArgs[0]).toContain('--enable');
    // Second call (resume) does not
    expect(capturedArgs[1]).not.toContain('--enable');
    expect(capturedArgs[1]).toContain('resume');
  });
});

// ─── Gemini Tool Support ───────────────────────────────────────────────

describe('GeminiBackend tool support', () => {
  let backend: GeminiBackend;
  let originalSpawn: typeof Bun.spawn;
  let originalWrite: typeof Bun.write;
  let capturedArgs: string[][] = [];

  beforeEach(() => {
    backend = new GeminiBackend();
    capturedArgs = [];

    originalSpawn = Bun.spawn;
    originalWrite = Bun.write;

    // Mock Bun.write for system prompt file creation
    // @ts-expect-error — mocking Bun.write for testing
    Bun.write = mock(() => Promise.resolve(0));

    // @ts-expect-error — mocking Bun.spawn for testing
    Bun.spawn = mock((...args: unknown[]) => {
      const cmd = args[0] as string[];
      capturedArgs.push(cmd);
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ type: 'init', session_id: 'sess-gemini-001' }) +
                  '\n' +
                  JSON.stringify({ type: 'message', role: 'assistant', content: 'ok' }) +
                  '\n' +
                  JSON.stringify({ type: 'result', status: 'success' }) +
                  '\n',
              ),
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
        exitCode: null,
        kill: () => {},
      };
    });
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    Bun.write = originalWrite;
  });

  test('capabilities report customTools: true', () => {
    expect(backend.capabilities.customTools).toBe(true);
    expect(BACKEND_CAPABILITIES[AIBackend.GEMINI].customTools).toBe(true);
  });

  test('includes --allowed-tools flags on first call', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'gemini-tool',
      systemPrompt: 'Test',
      tools: ['search', 'code_execution'],
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    const args = capturedArgs[0] as string[];
    expect(args).toContain('--allowed-tools');
    const toolIdx = args.indexOf('--allowed-tools');
    expect(args[toolIdx + 1]).toBe('search');
    expect(args[toolIdx + 2]).toBe('code_execution');
  });

  test('omits --allowed-tools when tools array is empty', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'no-tools',
      systemPrompt: 'Test',
      tools: [],
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    const args = capturedArgs[0] as string[];
    expect(args).not.toContain('--allowed-tools');
  });

  test('omits --allowed-tools when tools is undefined', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'no-tools',
      systemPrompt: 'Test',
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    const args = capturedArgs[0] as string[];
    expect(args).not.toContain('--allowed-tools');
  });

  test('resume call omits --allowed-tools (tools only on first call)', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'gemini-resume',
      systemPrompt: 'Test',
      tools: ['search'],
    };

    const proc = await backend.spawn(config);
    await proc.send('First');
    await proc.send('Second');

    // First call has --allowed-tools
    expect(capturedArgs[0]).toContain('--allowed-tools');
    // Second call (resume with session_id) does not
    expect(capturedArgs[1]).not.toContain('--allowed-tools');
    expect(capturedArgs[1]).toContain('--resume');
  });
});

// ─── Ollama Tool Support ──────────────────────────────────────────────

describe('OllamaBackend tool support', () => {
  let backend: OllamaBackend;
  let originalFetch: typeof globalThis.fetch;
  let capturedBodies: Record<string, unknown>[] = [];

  beforeEach(() => {
    backend = new OllamaBackend();
    capturedBodies = [];

    originalFetch = globalThis.fetch;
    // @ts-expect-error — mocking fetch for testing
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      if (init?.body) {
        capturedBodies.push(JSON.parse(init.body as string));
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true }) +
                  '\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      );
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('capabilities report customTools: true', () => {
    expect(backend.capabilities.customTools).toBe(true);
    expect(BACKEND_CAPABILITIES[AIBackend.OLLAMA].customTools).toBe(true);
  });

  test('includes tools in API request body when tools are configured', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'ollama-tool',
      systemPrompt: 'Test',
      tools: ['web_search', 'calculator'],
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0];
    expect(body.tools).toBeDefined();
    const tools = body.tools as Array<{ type: string; function: { name: string } }>;
    expect(tools).toHaveLength(2);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('web_search');
    expect(tools[1].function.name).toBe('calculator');
  });

  test('omits tools from API body when tools array is empty', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'no-tools',
      systemPrompt: 'Test',
      tools: [],
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].tools).toBeUndefined();
  });

  test('omits tools from API body when tools is undefined', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'no-tools',
      systemPrompt: 'Test',
    };

    const proc = await backend.spawn(config);
    await proc.send('Hello');

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].tools).toBeUndefined();
  });

  test('tools are included on every call (Ollama has no session resume)', async () => {
    const config: BackendSpawnConfig = {
      agentId: 'ollama-multi',
      systemPrompt: 'Test',
      tools: ['search'],
    };

    const proc = await backend.spawn(config);
    await proc.send('First');
    await proc.send('Second');

    // Both calls should include tools (Ollama manages state in-memory, no resume)
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0].tools).toBeDefined();
    expect(capturedBodies[1].tools).toBeDefined();
  });
});
