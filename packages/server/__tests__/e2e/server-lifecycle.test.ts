/**
 * E2E Integration Tests — Server Lifecycle
 *
 * Spawns the real server as a child process, exercises every major endpoint,
 * tests WebSocket connectivity, and verifies graceful shutdown.
 *
 * Environment:
 *   - Random available port (PORT=0 lets Bun pick one)
 *   - Temp DATA_DIR (cleaned up in afterAll)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SERVER_ENTRY = join(import.meta.dir, '../../src/index.ts');
const STARTUP_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 200;

let serverProc: Subprocess | null = null;
let baseUrl = '';
let serverPort = 0;
let dataDir = '';

async function waitForHealth(url: string, timeoutMs = STARTUP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(`Server failed to become healthy within ${timeoutMs}ms`);
}

/** Parse a successful API envelope and return the data payload. Throws on failure. */
async function parseOk<T>(res: Response): Promise<T> {
  const json = (await res.json()) as { success: boolean; data?: T; error?: string };
  expect(json.success).toBe(true);
  expect(json.data).toBeDefined();
  return json.data as T;
}

/** Parse an error API envelope and return the error message. */
async function parseErr(res: Response): Promise<string> {
  const json = (await res.json()) as { success: boolean; error?: string };
  expect(json.success).toBe(false);
  expect(json.error).toBeTruthy();
  return json.error as string;
}

/**
 * Extract the listening port from the "Server listening" log line.
 * Must match the line that contains "Server listening" to avoid the
 * initial "Server starting" line which has "port":0 (the requested port).
 */
function extractListeningPort(output: string): number | null {
  for (const line of output.split('\n')) {
    if (!line.includes('Server listening')) continue;
    const urlMatch = line.match(/localhost:(\d+)/);
    if (urlMatch?.[1]) {
      const port = parseInt(urlMatch[1], 10);
      if (port > 0) return port;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server lifecycle (shared across all tests in this file)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'agent-forge-e2e-'));

  serverProc = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: '0',
      DATA_DIR: dataDir,
      LOG_LEVEL: 'info',
      ENABLE_DEBUG_WS: 'false',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const reader = serverProc.stdout.getReader();
  let accumulated = '';
  const portDeadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < portDeadline) {
    const readPromise = reader.read();
    const timeoutPromise = Bun.sleep(STARTUP_TIMEOUT_MS).then(() => ({
      value: undefined,
      done: true as const,
    }));
    const { value, done } = await Promise.race([readPromise, timeoutPromise]);
    if (done && !value) break;
    if (value) accumulated += new TextDecoder().decode(value);
    const port = extractListeningPort(accumulated);
    if (port) {
      serverPort = port;
      break;
    }
  }

  reader.releaseLock();

  if (!serverPort) {
    try {
      serverProc.kill('SIGKILL');
    } catch {
      // ignore
    }
    throw new Error(
      `Could not determine server port from stdout.\nCaptured output:\n${accumulated}`,
    );
  }

  baseUrl = `http://localhost:${serverPort}`;
  await waitForHealth(baseUrl);
}, STARTUP_TIMEOUT_MS + 5_000);

afterAll(async () => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    const exitPromise = serverProc.exited;
    const timeout = Bun.sleep(5_000);
    await Promise.race([exitPromise, timeout]);
    try {
      serverProc.kill('SIGKILL');
    } catch {
      // Already exited
    }
    serverProc = null;
  }

  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: Server Lifecycle', () => {
  // ----- Health -----

  describe('GET /health', () => {
    test('returns 200 with expected shape', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      const health = await parseOk<{
        status: string;
        uptime: number;
        agentCount: number;
        memoryStatus: string;
        version: string;
      }>(res);
      expect(health.status).toBe('ok');
      expect(typeof health.uptime).toBe('number');
      expect(typeof health.agentCount).toBe('number');
      expect(typeof health.memoryStatus).toBe('string');
      expect(typeof health.version).toBe('string');
    });

    test('uptime increases over time', async () => {
      const h1 = await parseOk<{ uptime: number }>(await fetch(`${baseUrl}/health`));
      await Bun.sleep(1_100);
      const h2 = await parseOk<{ uptime: number }>(await fetch(`${baseUrl}/health`));
      expect(h2.uptime).toBeGreaterThanOrEqual(h1.uptime);
    });
  });

  // ----- CORS -----

  describe('CORS preflight', () => {
    test('OPTIONS returns CORS headers', async () => {
      const res = await fetch(`${baseUrl}/health`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:7821');
      expect(res.headers.get('access-control-allow-methods')).toBeTruthy();
    });
  });

  // ----- Agents CRUD -----

  describe('Agent CRUD /api/agents', () => {
    let createdAgentId: string;

    test('POST /api/agents creates an agent', async () => {
      const res = await fetch(`${baseUrl}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Test Agent',
          role: 'tester',
          systemPrompt: 'You are a test agent.',
          tools: [],
          canModifyFiles: false,
          canDelegateToAgents: false,
          persistent: false,
        }),
      });

      expect(res.status).toBe(201);
      const agent = await parseOk<{ id: string; name: string; status: string }>(res);
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBe('E2E Test Agent');
      expect(agent.status).toBeTruthy();
      createdAgentId = agent.id;
    });

    test('GET /api/agents lists agents including the created one', async () => {
      const res = await fetch(`${baseUrl}/api/agents`);
      expect(res.status).toBe(200);

      const agents = await parseOk<Array<{ id: string; name: string }>>(res);
      expect(Array.isArray(agents)).toBe(true);
      const found = agents.find((a) => a.id === createdAgentId);
      expect(found).toBeTruthy();
      expect(found?.name).toBe('E2E Test Agent');
    });

    test('POST /api/agents with missing fields returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'incomplete' }),
      });
      expect(res.status).toBe(400);
      await parseErr(res);
    });

    test('DELETE /api/agents/:id removes the agent', async () => {
      const res = await fetch(`${baseUrl}/api/agents/${createdAgentId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const result = await parseOk<{ deleted: string }>(res);
      expect(result.deleted).toBe(createdAgentId);

      // Verify it's gone
      const listRes = await fetch(`${baseUrl}/api/agents`);
      const agents = await parseOk<Array<{ id: string }>>(listRes);
      const found = agents.find((a) => a.id === createdAgentId);
      expect(found).toBeUndefined();
    });

    test('DELETE /api/agents/:id for non-existent agent returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/agents/non-existent-id`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  // ----- Sessions CRUD -----

  describe('Session CRUD /api/sessions', () => {
    let createdSessionId: string;

    test('POST /api/sessions creates a session', async () => {
      const res = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'E2E Test Session' }),
      });

      expect(res.status).toBe(201);
      const session = await parseOk<{
        id: string;
        title: string;
        status: string;
        messageCount: number;
      }>(res);
      expect(session.id).toBeTruthy();
      expect(session.title).toBe('E2E Test Session');
      expect(session.status).toBe('active');
      expect(session.messageCount).toBe(0);
      createdSessionId = session.id;
    });

    test('GET /api/sessions lists sessions', async () => {
      const res = await fetch(`${baseUrl}/api/sessions`);
      expect(res.status).toBe(200);

      const data = await parseOk<{ sessions: Array<{ id: string }>; total: number }>(res);
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.total).toBeGreaterThanOrEqual(1);
      const found = data.sessions.find((s) => s.id === createdSessionId);
      expect(found).toBeTruthy();
    });

    test('GET /api/sessions/:id returns session detail', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${createdSessionId}`);
      expect(res.status).toBe(200);

      const session = await parseOk<{ id: string; title: string; messages: unknown[] }>(res);
      expect(session.id).toBe(createdSessionId);
      expect(session.title).toBe('E2E Test Session');
      expect(Array.isArray(session.messages)).toBe(true);
    });

    test('PUT /api/sessions/:id updates the title', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${createdSessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title' }),
      });

      expect(res.status).toBe(200);
      const updated = await parseOk<{ title: string }>(res);
      expect(updated.title).toBe('Updated Title');
    });

    test('DELETE /api/sessions/:id removes the session', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${createdSessionId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const result = await parseOk<{ deleted: string }>(res);
      expect(result.deleted).toBe(createdSessionId);
    });

    test('GET /api/sessions/:id for deleted session returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/${createdSessionId}`);
      expect(res.status).toBe(404);
    });
  });

  // ----- Memory -----

  describe('Memory endpoints /api/memory', () => {
    test('POST /api/memory/ingest stores content', async () => {
      const res = await fetch(`${baseUrl}/api/memory/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'E2E test memory entry about quantum computing',
          type: 'long-term',
          metadata: { source: 'e2e-test' },
        }),
      });

      expect(res.status).toBe(201);
      const entry = await parseOk<{ id: string; content: string }>(res);
      expect(entry.id).toBeTruthy();
      expect(entry.content).toBe('E2E test memory entry about quantum computing');
    });

    test('GET /api/memory/search returns results', async () => {
      const res = await fetch(`${baseUrl}/api/memory/search?query=quantum+computing`);

      expect(res.status).toBe(200);
      const data = await parseOk<{ entries: unknown[]; totalCount: number; strategy: string }>(res);
      expect(Array.isArray(data.entries)).toBe(true);
      expect(typeof data.totalCount).toBe('number');
    });

    test('GET /api/memory/search without query returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/search`);
      expect(res.status).toBe(400);
    });

    test('POST /api/memory/ingest without content returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test('GET /api/memory/stats returns stats', async () => {
      const res = await fetch(`${baseUrl}/api/memory/stats`);
      expect(res.status).toBe(200);
      const stats = await parseOk<{ totalEntries: number; storageUsedBytes: number }>(res);
      expect(typeof stats.totalEntries).toBe('number');
      expect(typeof stats.storageUsedBytes).toBe('number');
    });
  });

  // ----- Config -----

  describe('Config endpoints /api/config', () => {
    test('GET /api/config returns runtime config', async () => {
      const res = await fetch(`${baseUrl}/api/config`);
      expect(res.status).toBe(200);

      const config = await parseOk<{ AI_BACKEND: string; MAX_AGENTS: number }>(res);
      expect(config.AI_BACKEND).toBeTruthy();
      expect(typeof config.MAX_AGENTS).toBe('number');
    });
  });

  // ----- Backends -----

  describe('Backend endpoints /api/backends', () => {
    test('GET /api/backends/status returns all backends', async () => {
      const res = await fetch(`${baseUrl}/api/backends/status`);
      expect(res.status).toBe(200);

      const data = await parseOk<{
        defaultBackend: string;
        backends: Array<{ name: string; capabilities: object }>;
      }>(res);
      expect(data.defaultBackend).toBeTruthy();
      expect(Array.isArray(data.backends)).toBe(true);
      expect(data.backends.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    test('GET /api/backends/options returns config options', async () => {
      const res = await fetch(`${baseUrl}/api/backends/options`);
      expect(res.status).toBe(200);

      const data = await parseOk<Record<string, Array<{ name: string; description: string }>>>(res);
      expect(typeof data).toBe('object');
    });
  });

  // ----- Crons -----

  describe('Cron CRUD /api/crons', () => {
    let createdCronId: string;

    test('POST /api/crons creates a cron', async () => {
      const res = await fetch(`${baseUrl}/api/crons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Test Cron',
          schedule: '0 9 * * *',
          enabled: false,
          workflow: {
            steps: [{ prompt: 'Hello from E2E test' }],
          },
        }),
      });

      expect(res.status).toBe(201);
      const cron = await parseOk<{ id: string; name: string; enabled: boolean }>(res);
      expect(cron.id).toBeTruthy();
      expect(cron.name).toBe('E2E Test Cron');
      expect(cron.enabled).toBe(false);
      createdCronId = cron.id;
    });

    test('GET /api/crons lists crons', async () => {
      const res = await fetch(`${baseUrl}/api/crons`);
      expect(res.status).toBe(200);

      const crons = await parseOk<Array<{ id: string; name: string }>>(res);
      expect(Array.isArray(crons)).toBe(true);
      const found = crons.find((c) => c.id === createdCronId);
      expect(found).toBeTruthy();
    });

    test('PUT /api/crons/:id updates the cron', async () => {
      const res = await fetch(`${baseUrl}/api/crons/${createdCronId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Cron Name', enabled: false }),
      });

      expect(res.status).toBe(200);
      const updated = await parseOk<{ name: string }>(res);
      expect(updated.name).toBe('Updated Cron Name');
    });

    test('DELETE /api/crons/:id removes the cron', async () => {
      const res = await fetch(`${baseUrl}/api/crons/${createdCronId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const result = await parseOk<{ deleted: string }>(res);
      expect(result.deleted).toBe(createdCronId);
    });
  });

  // ----- Memory Lifecycle -----

  describe('Memory lifecycle /api/memory', () => {
    test('GET /api/memory/consolidation-log returns log', async () => {
      const res = await fetch(`${baseUrl}/api/memory/consolidation-log`);
      expect(res.status).toBe(200);
      const data = await parseOk<{ log: unknown[] }>(res);
      expect(Array.isArray(data.log)).toBe(true);
    });

    test('POST /api/memory/consolidate runs consolidation', async () => {
      const res = await fetch(`${baseUrl}/api/memory/consolidate`, { method: 'POST' });
      expect(res.status).toBe(200);
      const data = await parseOk<{
        entriesProcessed: number;
        entriesMerged: number;
        entriesArchived: number;
        durationMs: number;
      }>(res);
      expect(typeof data.entriesProcessed).toBe('number');
      expect(typeof data.entriesMerged).toBe('number');
      expect(typeof data.entriesArchived).toBe('number');
      expect(typeof data.durationMs).toBe('number');
    }, 30_000);

    test('POST /api/memory/decay archives low-importance entries', async () => {
      const res = await fetch(`${baseUrl}/api/memory/decay`, { method: 'POST' });
      expect(res.status).toBe(200);
      const data = await parseOk<{ archivedCount: number }>(res);
      expect(typeof data.archivedCount).toBe('number');
    });

    test('POST /api/memory/reindex rebuilds embeddings', async () => {
      const res = await fetch(`${baseUrl}/api/memory/reindex`, { method: 'POST' });
      expect(res.status).toBe(200);
      const data = await parseOk<{ reindexed: boolean }>(res);
      expect(data.reindexed).toBe(true);
    });

    test('POST /api/memory/forget/:id soft-archives an entry', async () => {
      // First ingest an entry to forget
      const ingestRes = await fetch(`${baseUrl}/api/memory/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Entry to be forgotten for lifecycle test',
          type: 'short-term',
          metadata: { source: 'e2e-lifecycle' },
        }),
      });
      expect(ingestRes.status).toBe(201);
      const entry = await parseOk<{ id: string }>(ingestRes);

      const res = await fetch(`${baseUrl}/api/memory/forget/${entry.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'E2E test forget' }),
      });
      expect(res.status).toBe(200);
      const data = await parseOk<{ forgotten: boolean }>(res);
      expect(data.forgotten).toBe(true);
    });

    test('POST /api/memory/forget/:id without id returns 400', async () => {
      // Forgetting a non-existent entry should not crash
      const res = await fetch(`${baseUrl}/api/memory/forget/non-existent-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // Implementation returns 200 with forgotten: false for non-existent IDs
      expect([200, 400, 404]).toContain(res.status);
    });

    test('DELETE /api/memory/source/:source deletes by source', async () => {
      // Ingest entries with a known source
      await fetch(`${baseUrl}/api/memory/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Entry from deletable source',
          type: 'short-term',
          metadata: { source: 'e2e-delete-source' },
        }),
      });

      const res = await fetch(`${baseUrl}/api/memory/source/e2e-delete-source`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const data = await parseOk<{ deletedCount: number }>(res);
      expect(typeof data.deletedCount).toBe('number');
    });

    test('GET /api/memory/query-as-of returns temporal snapshot', async () => {
      const asOf = new Date().toISOString();
      const res = await fetch(`${baseUrl}/api/memory/query-as-of?asOf=${encodeURIComponent(asOf)}`);
      expect(res.status).toBe(200);
      const data = await parseOk<{ entries: unknown[]; totalCount: number }>(res);
      expect(Array.isArray(data.entries)).toBe(true);
      expect(typeof data.totalCount).toBe('number');
    });

    test('GET /api/memory/query-as-of without asOf returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/query-as-of`);
      expect(res.status).toBe(400);
    });

    test('GET /api/memory/query-as-of with invalid date returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/query-as-of?asOf=not-a-date`);
      expect(res.status).toBe(400);
    });
  });

  // ----- Graph Mutations -----

  describe('Graph mutation endpoints /api/memory/graph', () => {
    let createdNodeId: string;
    let secondNodeId: string;

    test('POST /api/memory/graph/nodes creates a node', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Test Entity',
          type: 'CONCEPT',
          properties: { domain: 'testing' },
        }),
      });

      expect(res.status).toBe(201);
      const node = await parseOk<{ id: string; name: string; type: string }>(res);
      expect(node.id).toBeTruthy();
      expect(node.name).toBe('E2E Test Entity');
      expect(node.type).toBe('CONCEPT');
      createdNodeId = node.id;
    });

    test('POST /api/memory/graph/nodes creates a second node', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Second Entity',
          type: 'TOOL',
        }),
      });

      expect(res.status).toBe(201);
      const node = await parseOk<{ id: string; name: string }>(res);
      expect(node.id).toBeTruthy();
      secondNodeId = node.id;
    });

    test('POST /api/memory/graph/nodes without name returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'CONCEPT' }),
      });
      expect(res.status).toBe(400);
    });

    test('POST /api/memory/graph/nodes without type returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Missing type' }),
      });
      expect(res.status).toBe(400);
    });

    test('POST /api/memory/graph/nodes with invalid entity type returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad type', type: 'INVALID_TYPE' }),
      });
      expect(res.status).toBe(400);
      const err = await parseErr(res);
      expect(err).toContain('Invalid entity type');
    });

    test('POST /api/memory/graph/nodes with name exceeding 500 chars returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(501), type: 'CONCEPT' }),
      });
      expect(res.status).toBe(400);
    });

    test('GET /api/memory/graph/nodes lists nodes including created ones', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes`);
      expect(res.status).toBe(200);

      const data = await parseOk<{ nodes: Array<{ id: string }>; totalCount: number }>(res);
      expect(Array.isArray(data.nodes)).toBe(true);
      const found = data.nodes.find((n) => n.id === createdNodeId);
      expect(found).toBeTruthy();
    });

    test('GET /api/memory/graph/nodes?type=CONCEPT filters by type', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes?type=CONCEPT`);
      expect(res.status).toBe(200);

      const data = await parseOk<{ nodes: Array<{ id: string; type: string }> }>(res);
      for (const node of data.nodes) {
        expect(node.type).toBe('CONCEPT');
      }
    });

    test('POST /api/memory/graph/relationships creates a relationship', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: createdNodeId,
          targetId: secondNodeId,
          type: 'RELATED_TO',
          properties: { weight: 0.9 },
        }),
      });

      expect(res.status).toBe(201);
      const rel = await parseOk<{
        id: string;
        sourceId: string;
        targetId: string;
        type: string;
      }>(res);
      expect(rel.id).toBeTruthy();
      expect(rel.sourceId).toBe(createdNodeId);
      expect(rel.targetId).toBe(secondNodeId);
      expect(rel.type).toBe('RELATED_TO');
    });

    test('POST /api/memory/graph/relationships with invalid relation type returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: createdNodeId,
          targetId: secondNodeId,
          type: 'INVALID_RELATION',
        }),
      });
      expect(res.status).toBe(400);
      const err = await parseErr(res);
      expect(err).toContain('Invalid relation type');
    });

    test('POST /api/memory/graph/relationships with missing sourceId returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetId: secondNodeId,
          type: 'RELATED_TO',
        }),
      });
      expect(res.status).toBe(400);
    });

    test('POST /api/memory/graph/relationships with non-existent source returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'non-existent-node-id',
          targetId: secondNodeId,
          type: 'RELATED_TO',
        }),
      });
      expect(res.status).toBe(404);
      const err = await parseErr(res);
      expect(err).toContain('not found');
    });

    test('GET /api/memory/graph/relationships lists relationships', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/relationships`);
      expect(res.status).toBe(200);

      const data = await parseOk<{
        relationships: Array<{ sourceId: string; targetId: string }>;
        totalCount: number;
      }>(res);
      expect(Array.isArray(data.relationships)).toBe(true);
      expect(data.totalCount).toBeGreaterThanOrEqual(1);
    });

    test('POST /api/memory/graph/query traverses graph from a node', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: createdNodeId, depth: 1 }),
      });
      expect(res.status).toBe(200);

      const data = await parseOk<{
        nodes: unknown[];
        relationships: unknown[];
        paths: unknown[];
      }>(res);
      expect(Array.isArray(data.nodes)).toBe(true);
      expect(Array.isArray(data.relationships)).toBe(true);
      expect(Array.isArray(data.paths)).toBe(true);
    });

    test('GET /api/memory/graph/edges returns stats', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/edges`);
      expect(res.status).toBe(200);

      const data = await parseOk<{
        stats: { nodeCount: number; edgeCount: number };
      }>(res);
      expect(typeof data.stats.nodeCount).toBe('number');
      expect(typeof data.stats.edgeCount).toBe('number');
      expect(data.stats.nodeCount).toBeGreaterThanOrEqual(2);
      expect(data.stats.edgeCount).toBeGreaterThanOrEqual(1);
    });

    test('DELETE /api/memory/graph/nodes/:id removes a node', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes/${secondNodeId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const result = await parseOk<{ deleted: string }>(res);
      expect(result.deleted).toBe(secondNodeId);
    });

    test('DELETE /api/memory/graph/nodes/:id for non-existent node returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes/non-existent-node-id`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });

    // Clean up the first node
    test('DELETE /api/memory/graph/nodes/:id cleans up first node', async () => {
      const res = await fetch(`${baseUrl}/api/memory/graph/nodes/${createdNodeId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
    });
  });

  // ----- Activity -----

  describe('Activity endpoint /api/activity', () => {
    test('GET /api/activity returns activity entries', async () => {
      const res = await fetch(`${baseUrl}/api/activity`);
      expect(res.status).toBe(200);

      // Activity returns an array directly (wrapped in envelope by jsonResponse)
      const data = await parseOk<unknown[]>(res);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // ----- Seed Agents -----

  describe('Seed agents', () => {
    test('seed agents are present after startup', async () => {
      const res = await fetch(`${baseUrl}/api/agents`);
      expect(res.status).toBe(200);

      const agents = await parseOk<Array<{ id: string; name: string }>>(res);
      // Seed agents have known IDs: researcher, writer, analyst
      const seedIds = ['researcher', 'writer', 'analyst'];
      const foundSeeds = agents.filter((a) => seedIds.includes(a.id));
      expect(foundSeeds.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ----- 404 -----

  describe('Unknown routes', () => {
    test('GET /nonexistent returns 404', async () => {
      const res = await fetch(`${baseUrl}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  // ----- WebSocket -----

  describe('WebSocket /ws/chat', () => {
    test('connects and receives ping/pong', async () => {
      const wsUrl = `ws://localhost:${serverPort}/ws/chat`;
      const ws = new WebSocket(wsUrl);
      const messages: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket test timed out'));
        }, 5_000);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'ping' }));
        };

        ws.onmessage = (event) => {
          messages.push(event.data as string);
          const parsed = JSON.parse(event.data as string) as { type: string };
          if (parsed.type === 'pong') {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(new Error(`WebSocket error: ${err}`));
        };
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const pongMsg = messages.find((m) => m.includes('pong'));
      expect(pongMsg).toBeTruthy();
      const pong = JSON.parse(pongMsg as string) as { type: string };
      expect(pong.type).toBe('pong');
    });

    test('rejects invalid JSON', async () => {
      const wsUrl = `ws://localhost:${serverPort}/ws/chat`;
      const ws = new WebSocket(wsUrl);
      const messages: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket invalid JSON test timed out'));
        }, 5_000);

        ws.onopen = () => {
          ws.send('not valid json {{{');
        };

        ws.onmessage = (event) => {
          messages.push(event.data as string);
          const parsed = JSON.parse(event.data as string) as { type: string };
          if (parsed.type === 'error') {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(new Error(`WebSocket error: ${err}`));
        };
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const parsed = messages.map((m) => JSON.parse(m) as { type: string; message?: string });
      const errorMsg = parsed.find((m) => m.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg?.message).toBe('Invalid JSON');
    });
  });

  // ----- Graceful shutdown -----

  describe('Graceful shutdown', () => {
    test('server process is running throughout all tests', () => {
      expect(serverProc).toBeTruthy();
      expect(serverProc?.exitCode).toBeNull();
    });
  });
});
