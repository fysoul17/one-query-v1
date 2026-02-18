// @autonomy/server — Bun.serve HTTP/WS entry point

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { AgentPool, ClaudeBackend, DefaultBackendRegistry } from '@autonomy/agent-manager';
import { Conductor } from '@autonomy/conductor';
import {
  AuthMiddleware,
  AuthStore,
  InstanceRegistry,
  QuotaManager,
  setAuthContext,
  UsageStore,
  UsageTracker,
} from '@autonomy/control-plane';
import { CronManager } from '@autonomy/cron-manager';
import { createMemory, StubEmbeddingProvider } from '@autonomy/memory';
import { HookRegistry, PluginManager } from '@autonomy/plugin-system';
import { DebugEventCategory, DebugEventLevel } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import { parseEnvConfig } from './config.ts';
import { ConfigManager } from './config-manager.ts';
import { DebugBus, makeDebugEvent } from './debug-bus.ts';
import { createDebugWebSocketHandler, type DebugWSData } from './debug-websocket.ts';
import { Router } from './router.ts';
import { createActivityRoute } from './routes/activity.ts';
import { createAgentRoutes } from './routes/agents.ts';
import { createAuthRoutes } from './routes/auth.ts';
import { createConfigRoutes } from './routes/config.ts';
import { createCronRoutes } from './routes/crons.ts';
import { createHealthRoute } from './routes/health.ts';
import { createInstanceRoutes } from './routes/instances.ts';
import { createMemoryRoutes } from './routes/memory.ts';
import { createUsageRoutes } from './routes/usage.ts';
import { createWebSocketHandler, type WSData } from './websocket.ts';

export { parseEnvConfig } from './config.ts';
export { ConfigManager, ConfigUpdateError } from './config-manager.ts';
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
export { createAuthRoutes } from './routes/auth.ts';
export { createConfigRoutes } from './routes/config.ts';
export { createCronRoutes } from './routes/crons.ts';
export { createHealthRoute } from './routes/health.ts';
export { createInstanceRoutes } from './routes/instances.ts';
export { createMemoryRoutes } from './routes/memory.ts';
export { createUsageRoutes } from './routes/usage.ts';
export { createWebSocketHandler, type WSData } from './websocket.ts';

// --- Bootstrap (only when run directly) ---

const stubProvider = new StubEmbeddingProvider();
const stubEmbedder = (texts: string[]) => stubProvider.embed(texts);

// --- Combined WS data type for Bun.serve ---

type CombinedWSData = (WSData & { type: 'chat' }) | DebugWSData;

async function main() {
  const startTime = Date.now();
  const config = parseEnvConfig();
  const configManager = new ConfigManager(config);
  configManager.initialize();
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

  // Initialize Control Plane (SQLite DB for auth, usage, instances)
  const { mkdirSync, existsSync } = await import('node:fs');
  if (!existsSync(config.DATA_DIR)) {
    mkdirSync(config.DATA_DIR, { recursive: true });
  }
  const controlPlaneDb = new Database(join(config.DATA_DIR, 'control-plane.sqlite'));
  controlPlaneDb.exec('PRAGMA journal_mode = WAL;');
  const authStore = new AuthStore(controlPlaneDb);
  const usageStore = new UsageStore(controlPlaneDb);
  const authMiddleware = new AuthMiddleware(authStore, {
    enabled: config.AUTH_ENABLED,
    masterKey: config.AUTH_MASTER_KEY,
  });
  const quotaManager = new QuotaManager(usageStore);
  const usageTracker = new UsageTracker(usageStore);
  const instanceRegistry = new InstanceRegistry(controlPlaneDb, {
    heartbeatIntervalMs: 30_000,
    staleThresholdMs: 90_000,
  });
  console.log(
    `[server] Control plane initialized (auth=${config.AUTH_ENABLED ? 'enabled' : 'disabled'})`,
  );

  // Initialize Memory (uses MemoryClient if MEMORY_URL is set, otherwise embedded)
  const memory = createMemory({
    dataDir: config.DATA_DIR,
    vectorProvider: config.VECTOR_PROVIDER,
    qdrantUrl: config.QDRANT_URL,
    embedder: stubEmbedder,
    memoryUrl: config.MEMORY_URL,
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

  // Initialize Plugin System
  const hookRegistry = new HookRegistry();
  const pluginManager = new PluginManager(hookRegistry);
  console.log('[server] Plugin system initialized');
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.SYSTEM,
      level: DebugEventLevel.INFO,
      source: 'plugin-system.init',
      message: 'Plugin system initialized',
    }),
  );

  // Initialize Backend Registry
  const registry = new DefaultBackendRegistry(config.AI_BACKEND);
  registry.register(new ClaudeBackend());
  // Future: registry.register(new GooseBackend()), etc.

  // Initialize Agent Pool (with registry for per-agent backend selection)
  const pool = new AgentPool(registry, {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    hookRegistry,
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

  // Initialize Conductor (with default backend for direct AI responses)
  const conductor = new Conductor(pool, memory, registry.getDefault(), {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    hookRegistry,
  });
  await conductor.initialize();
  console.log('[server] Conductor initialized');
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.CONDUCTOR,
      level: DebugEventLevel.INFO,
      source: 'conductor.init',
      message: 'Conductor initialized',
    }),
  );

  // Initialize CronManager
  const cronManager = new CronManager(conductor, { dataDir: config.DATA_DIR });
  await cronManager.initialize();
  console.log('[server] CronManager initialized');

  // Register instance
  instanceRegistry.register(config.PORT, '0.0.0');
  console.log('[server] Instance registered');

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
  const cronRoutes = createCronRoutes(cronManager);
  const activityRoute = createActivityRoute(conductor);
  const configRoutes = createConfigRoutes(configManager);
  const authRoutes = createAuthRoutes(authStore, authMiddleware);
  const usageRoutes = createUsageRoutes(usageStore, authMiddleware);
  const instanceRoutes = createInstanceRoutes(instanceRegistry);

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
  router.post('/api/crons/:id/trigger', cronRoutes.trigger);

  router.get('/api/activity', activityRoute);

  router.get('/api/config', configRoutes.get);
  router.put('/api/config', configRoutes.update);

  // Auth routes
  router.get('/api/auth/keys', authRoutes.listKeys);
  router.post('/api/auth/keys', authRoutes.createKey);
  router.get('/api/auth/keys/:id', authRoutes.getKey);
  router.put('/api/auth/keys/:id', authRoutes.updateKey);
  router.delete('/api/auth/keys/:id', authRoutes.deleteKey);

  // Usage routes
  router.get('/api/usage/summary', usageRoutes.summary);
  router.get('/api/usage/quotas/:keyId', usageRoutes.getQuota);
  router.put('/api/usage/quotas/:keyId', usageRoutes.setQuota);

  // Instance routes
  router.get('/api/instances', instanceRoutes.list);

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

    async fetch(req, server) {
      const url = new URL(req.url);

      // Chat WebSocket upgrade (with auth support via query token)
      if (url.pathname === '/ws/chat') {
        // Auth for WS: check token query param if auth enabled
        if (config.AUTH_ENABLED) {
          const wsAuthResult = authMiddleware.authenticate(req);
          if (wsAuthResult instanceof Response) return wsAuthResult;
        }
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

      // Auth → Quota → Route → Usage tracking
      const authResult = authMiddleware.authenticate(req);
      if (authResult instanceof Response) return authResult;

      const quotaResult = quotaManager.check(authResult);
      if (quotaResult) return quotaResult;

      setAuthContext(req, authResult);

      const start = performance.now();
      const response = await router.handle(req);
      usageTracker.track(req, response, authResult, performance.now() - start);

      return response;
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
    instanceRegistry.deregister();
    ws.shutdown();
    debugWs.shutdown();
    await pluginManager.shutdown();
    await cronManager.shutdown();
    await conductor.shutdown();
    await pool.shutdown();
    await memory.shutdown();
    controlPlaneDb.close();
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
