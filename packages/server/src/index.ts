// @autonomy/server — Bun.serve HTTP/WS entry point

import { AgentPool, getBackend } from '@autonomy/agent-manager';
import { Conductor } from '@autonomy/conductor';
import { Memory } from '@autonomy/memory';
import { parseEnvConfig } from './config.ts';
import { createActivityRoute } from './routes/activity.ts';
import { createAgentRoutes } from './routes/agents.ts';
import { createConfigRoutes } from './routes/config.ts';
import { createCronRoutes } from './routes/crons.ts';
import { createHealthRoute } from './routes/health.ts';
import { createMemoryRoutes } from './routes/memory.ts';
import { Router } from './router.ts';
import { createWebSocketHandler, type WSData } from './websocket.ts';

// --- Exports for library use ---
export { BadRequestError, InternalError, NotFoundError, ServerError } from './errors.ts';
export { parseEnvConfig } from './config.ts';
export { Router, type RouteHandler, type RouteParams } from './router.ts';
export {
  corsHeaders,
  errorResponse,
  handlePreflight,
  jsonResponse,
  parseJsonBody,
} from './middleware.ts';
export { createWebSocketHandler, type WSData } from './websocket.ts';
export { createHealthRoute } from './routes/health.ts';
export { createAgentRoutes } from './routes/agents.ts';
export { createMemoryRoutes } from './routes/memory.ts';
export { createCronRoutes } from './routes/crons.ts';
export { createActivityRoute } from './routes/activity.ts';
export { createConfigRoutes } from './routes/config.ts';

// --- Bootstrap (only when run directly) ---

function stubEmbedder(texts: string[]): Promise<number[][]> {
  // Stub embedder: returns zero vectors for development.
  // Real embedding (Anthropic/OpenAI) requires API key configuration.
  return Promise.resolve(texts.map(() => new Array(1024).fill(0) as number[]));
}

async function main() {
  const startTime = Date.now();
  const config = parseEnvConfig();

  console.log(`[server] Starting with config: PORT=${config.PORT}, BACKEND=${config.AI_BACKEND}`);

  // Initialize Memory
  const memory = new Memory({
    dataDir: config.DATA_DIR,
    vectorProvider: config.VECTOR_PROVIDER,
    qdrantUrl: config.QDRANT_URL,
    embedder: stubEmbedder,
  });
  await memory.initialize();
  console.log('[server] Memory initialized');

  // Initialize Agent Pool
  const backend = getBackend(config.AI_BACKEND);
  const pool = new AgentPool(backend, {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
  });
  console.log('[server] Agent pool created');

  // Initialize Conductor
  const conductor = new Conductor(pool, memory);
  await conductor.initialize();
  console.log('[server] Conductor initialized');

  // Create WebSocket handler
  const ws = createWebSocketHandler(conductor);

  // Build HTTP router
  const router = new Router();

  const healthRoute = createHealthRoute(conductor, memory, startTime);
  const agentRoutes = createAgentRoutes(conductor, pool);
  const memoryRoutes = createMemoryRoutes(memory);
  const cronRoutes = createCronRoutes();
  const activityRoute = createActivityRoute(conductor);
  const configRoutes = createConfigRoutes(config);

  router.get('/health', healthRoute);

  router.get('/api/agents', agentRoutes.list);
  router.post('/api/agents', agentRoutes.create);
  router.put('/api/agents/:id', agentRoutes.update);
  router.delete('/api/agents/:id', agentRoutes.remove);
  router.post('/api/agents/:id/restart', agentRoutes.restart);

  router.get('/api/memory/search', memoryRoutes.search);
  router.post('/api/memory/ingest', memoryRoutes.ingest);
  router.get('/api/memory/stats', memoryRoutes.stats);

  router.get('/api/crons', cronRoutes.list);
  router.post('/api/crons', cronRoutes.create);
  router.put('/api/crons/:id', cronRoutes.update);
  router.delete('/api/crons/:id', cronRoutes.remove);

  router.get('/api/activity', activityRoute);

  router.get('/api/config', configRoutes.get);
  router.put('/api/config', configRoutes.update);

  // Start Bun.serve
  const server = Bun.serve<WSData>({
    port: config.PORT,

    fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === '/ws/chat') {
        const upgraded = server.upgrade(req, {
          data: { id: crypto.randomUUID() },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      return router.handle(req);
    },

    websocket: ws.handler,
  });

  console.log(`[server] Listening on http://localhost:${server.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[server] Shutting down...');
    ws.shutdown();
    await conductor.shutdown();
    await pool.shutdown();
    await memory.shutdown();
    server.stop();
    console.log('[server] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run main when this is the entry point
const isMainModule =
  typeof Bun !== 'undefined' && Bun.main === import.meta.path;

if (isMainModule) {
  main().catch((error) => {
    console.error('[server] Fatal error:', error);
    process.exit(1);
  });
}
