// @autonomy/server — Bun.serve HTTP/WS entry point

import { AgentPool, getBackend } from '@autonomy/agent-manager';
import { Conductor } from '@autonomy/conductor';
import { Memory } from '@autonomy/memory';
import { DebugEventCategory, DebugEventLevel } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import { parseEnvConfig } from './config.ts';
import { DebugBus, makeDebugEvent } from './debug-bus.ts';
import { createDebugWebSocketHandler, type DebugWSData } from './debug-websocket.ts';
import { Router } from './router.ts';
import { createActivityRoute } from './routes/activity.ts';
import { createAgentRoutes } from './routes/agents.ts';
import { createConfigRoutes } from './routes/config.ts';
import { createCronRoutes } from './routes/crons.ts';
import { createHealthRoute } from './routes/health.ts';
import { createMemoryRoutes } from './routes/memory.ts';
import { createWebSocketHandler, type WSData } from './websocket.ts';

export { parseEnvConfig } from './config.ts';
export { DebugBus, makeDebugEvent } from './debug-bus.ts';
export { createDebugWebSocketHandler, type DebugWSData } from './debug-websocket.ts';
// --- Exports for library use ---
export { BadRequestError, InternalError, NotFoundError, ServerError } from './errors.ts';
export {
  corsHeaders,
  errorResponse,
  handlePreflight,
  jsonResponse,
  parseJsonBody,
} from './middleware.ts';
export { type RouteHandler, type RouteParams, Router } from './router.ts';
export { createActivityRoute } from './routes/activity.ts';
export { createAgentRoutes } from './routes/agents.ts';
export { createConfigRoutes } from './routes/config.ts';
export { createCronRoutes } from './routes/crons.ts';
export { createHealthRoute } from './routes/health.ts';
export { createMemoryRoutes } from './routes/memory.ts';
export { createWebSocketHandler, type WSData } from './websocket.ts';

// --- Bootstrap (only when run directly) ---

function stubEmbedder(texts: string[]): Promise<number[][]> {
  // Deterministic hash-based embedder for development.
  // Produces distinct vectors for different texts (enables meaningful search).
  // Real embedding (Anthropic/OpenAI) requires API key configuration.
  return Promise.resolve(texts.map((text) => hashToVector(text, 1024)));
}

/** Generate a deterministic vector from text via simple hash. */
function hashToVector(text: string, dimensions: number): number[] {
  const vector: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    let hash = 0;
    const seed = text + String(i);
    for (let j = 0; j < seed.length; j++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(j)) | 0;
    }
    vector.push(Math.sin(hash));
  }
  return vector;
}

// --- Combined WS data type for Bun.serve ---

type CombinedWSData = (WSData & { type: 'chat' }) | DebugWSData;

async function main() {
  const startTime = Date.now();
  const config = parseEnvConfig();
  const env = typeof Bun !== 'undefined' ? Bun.env : process.env;
  const debugWsEnabled = env.ENABLE_DEBUG_WS !== 'false';
  const debugWsToken = env.DEBUG_WS_TOKEN;

  console.log(`[server] Starting with config: PORT=${config.PORT}, BACKEND=${config.AI_BACKEND}`);

  // Initialize DebugBus
  const debugBus = new DebugBus(500);

  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.SYSTEM,
      level: DebugEventLevel.INFO,
      source: 'server.startup',
      message: 'Server starting',
    }),
  );

  // Initialize Memory
  const memory = new Memory({
    dataDir: config.DATA_DIR,
    vectorProvider: config.VECTOR_PROVIDER,
    qdrantUrl: config.QDRANT_URL,
    embedder: stubEmbedder,
  });
  await memory.initialize();
  console.log('[server] Memory initialized');
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.MEMORY,
      level: DebugEventLevel.INFO,
      source: 'memory.init',
      message: 'Memory system initialized',
    }),
  );

  // Initialize Agent Pool
  const backend = getBackend(config.AI_BACKEND);
  const pool = new AgentPool(backend, {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
  });
  console.log('[server] Agent pool created');
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.AGENT,
      level: DebugEventLevel.INFO,
      source: 'agent-pool.init',
      message: `Agent pool created (max=${config.MAX_AGENTS}, idleTimeout=${config.IDLE_TIMEOUT_MS}ms)`,
    }),
  );

  // Initialize Conductor (with AI backend for intelligent routing)
  const conductor = new Conductor(pool, memory, backend);
  await conductor.initialize();
  console.log('[server] Conductor initialized');
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.CONDUCTOR,
      level: DebugEventLevel.INFO,
      source: 'conductor.init',
      message: 'Conductor initialized with AI routing',
    }),
  );

  // Create WebSocket handlers
  const ws = createWebSocketHandler(conductor, debugBus);
  const debugWs = createDebugWebSocketHandler(debugBus);
  if (debugWsEnabled) {
    console.log(
      `[server] Debug WebSocket enabled at /ws/debug${debugWsToken ? ' (token-protected)' : ' (no token — use DEBUG_WS_TOKEN for auth)'}`,
    );
  }

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

  function handleDebugUpgrade(
    req: Request,
    srv: { upgrade(req: Request, options: { data: CombinedWSData }): boolean },
    url: URL,
  ): Response | undefined {
    if (!debugWsEnabled) {
      return new Response('Debug WebSocket is disabled', { status: 403 });
    }
    if (debugWsToken && url.searchParams.get('token') !== debugWsToken) {
      return new Response('Unauthorized', { status: 401 });
    }
    const upgraded = srv.upgrade(req, {
      data: { id: crypto.randomUUID(), type: 'debug' as const },
    });
    if (upgraded) return undefined;
    return new Response('WebSocket upgrade failed', { status: 400 });
  }

  // Start Bun.serve with combined WS handler
  const server = Bun.serve<CombinedWSData>({
    port: config.PORT,

    fetch(req, server) {
      const url = new URL(req.url);

      // Chat WebSocket upgrade
      if (url.pathname === '/ws/chat') {
        const upgraded = server.upgrade(req, {
          data: { id: crypto.randomUUID(), type: 'chat' as const },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Debug WebSocket upgrade (gated by ENABLE_DEBUG_WS env var)
      if (url.pathname === '/ws/debug') {
        return handleDebugUpgrade(req, server, url) as Response;
      }

      return router.handle(req);
    },

    websocket: {
      open(socket: ServerWebSocket<CombinedWSData>) {
        if (socket.data.type === 'debug') {
          debugWs.handler.open(socket as ServerWebSocket<DebugWSData>);
        } else {
          ws.handler.open(socket as ServerWebSocket<WSData>);
        }
      },
      async message(socket: ServerWebSocket<CombinedWSData>, raw: string | Buffer) {
        if (socket.data.type === 'debug') {
          debugWs.handler.message(socket as ServerWebSocket<DebugWSData>, raw);
        } else {
          await ws.handler.message(socket as ServerWebSocket<WSData>, raw);
        }
      },
      close(socket: ServerWebSocket<CombinedWSData>) {
        if (socket.data.type === 'debug') {
          debugWs.handler.close(socket as ServerWebSocket<DebugWSData>);
        } else {
          ws.handler.close(socket as ServerWebSocket<WSData>);
        }
      },
    },
  });

  console.log(`[server] Listening on http://localhost:${server.port}`);
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.SYSTEM,
      level: DebugEventLevel.INFO,
      source: 'server.ready',
      message: `Server listening on port ${server.port}`,
      durationMs: Date.now() - startTime,
    }),
  );

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[server] Shutting down...');
    debugBus.emit(
      makeDebugEvent({
        category: DebugEventCategory.SYSTEM,
        level: DebugEventLevel.WARN,
        source: 'server.shutdown',
        message: 'Server shutting down',
      }),
    );
    ws.shutdown();
    debugWs.shutdown();
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
const isMainModule = typeof Bun !== 'undefined' && Bun.main === import.meta.path;

if (isMainModule) {
  main().catch((error) => {
    console.error('[server] Fatal error:', error);
    process.exit(1);
  });
}
