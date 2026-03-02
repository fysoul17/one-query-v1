import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import { SessionProcessPool } from '../src/session-process-pool.ts';

function createMockProcess(overrides?: Partial<BackendProcess>): BackendProcess {
  return {
    send: mock(async (_msg: string) => 'mock response'),
    stop: mock(async () => {}),
    alive: true,
    nativeSessionId: undefined,
    ...overrides,
  };
}

function createMockBackend(overrides?: Partial<CLIBackend>): CLIBackend {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    name: 'claude' as any,
    capabilities: {
      customTools: false,
      streaming: false,
      sessionPersistence: false,
      fileAccess: false,
    },
    spawn: mock(async () => createMockProcess()),
    getConfigOptions: () => [],
    ...overrides,
  };
}

describe('SessionProcessPool', () => {
  let backend: ReturnType<typeof createMockBackend>;
  let pool: SessionProcessPool;

  beforeEach(() => {
    backend = createMockBackend();
    pool = new SessionProcessPool(backend, undefined, 'Test system prompt', 100);
  });

  describe('getProcess()', () => {
    test('returns undefined for unknown sessionId', () => {
      const result = pool.getProcess('unknown-session');
      expect(result).toBeUndefined();
    });

    test('returns the process after getOrCreate()', async () => {
      const proc = await pool.getOrCreate('session-1');
      expect(proc).toBeDefined();

      const retrieved = pool.getProcess('session-1');
      expect(retrieved).toBeDefined();
      expect(retrieved).toBe(proc);
    });

    test('returns undefined when the process is dead (alive = false)', async () => {
      const deadProcess = createMockProcess({ alive: false });
      const deadBackend = createMockBackend({
        spawn: mock(async () => deadProcess),
      });
      const deadPool = new SessionProcessPool(deadBackend, undefined, 'Test', 100);

      await deadPool.getOrCreate('session-dead');
      // The process was inserted but is not alive
      const result = deadPool.getProcess('session-dead');
      expect(result).toBeUndefined();
    });
  });

  describe('getOrCreate() with backendSessionId', () => {
    test('passes sessionId to spawn config when backendSessionId is provided', async () => {
      await pool.getOrCreate('session-resume', undefined, 'native-sess-456');

      expect(backend.spawn).toHaveBeenCalledTimes(1);
      const spawnCall = (backend.spawn as ReturnType<typeof mock>).mock.calls[0] as [
        Record<string, unknown>,
      ];
      const config = spawnCall[0];
      expect(config.sessionId).toBe('native-sess-456');
    });

    test('does not include sessionId in spawn config when backendSessionId is omitted', async () => {
      await pool.getOrCreate('session-fresh');

      expect(backend.spawn).toHaveBeenCalledTimes(1);
      const spawnCall = (backend.spawn as ReturnType<typeof mock>).mock.calls[0] as [
        Record<string, unknown>,
      ];
      const config = spawnCall[0];
      expect(config.sessionId).toBeUndefined();
    });

    test('returns existing alive process without re-spawning', async () => {
      await pool.getOrCreate('session-reuse');
      await pool.getOrCreate('session-reuse');

      // Only spawned once since process is alive
      expect(backend.spawn).toHaveBeenCalledTimes(1);
    });
  });
});
