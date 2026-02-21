// @autonomy/server — Bun.serve HTTP/WS entry point

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { AgentPool, ClaudeBackend, DefaultBackendRegistry } from '@autonomy/agent-manager';
import { Conductor } from '@autonomy/conductor';
import {
  AgentStore,
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
import { DebugEventCategory, DebugEventLevel, Logger } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import { parseEnvConfig } from './config.ts';
import { ConfigManager } from './config-manager.ts';
import { DebugBus, makeDebugEvent } from './debug-bus.ts';
import { createDebugWebSocketHandler, type DebugWSData } from './debug-websocket.ts';
import { RateLimiter } from './rate-limiter.ts';
import { Router } from './router.ts';
import { createActivityRoute } from './routes/activity.ts';
import { createAgentRoutes } from './routes/agents.ts';
import { createAuthRoutes } from './routes/auth.ts';
import { createBackendRoutes } from './routes/backends.ts';
import { createConfigRoutes } from './routes/config.ts';
import { createCronRoutes } from './routes/crons.ts';
import { createHealthRoute } from './routes/health.ts';
import { createInstanceRoutes } from './routes/instances.ts';
import { createMemoryRoutes } from './routes/memory.ts';
import { createSessionRoutes } from './routes/sessions.ts';
import { createUsageRoutes } from './routes/usage.ts';
import { runSeeds } from './seeds/index.ts';
import { SessionStore } from './session-store.ts';
import { createTerminalWebSocketHandler, type TerminalWSData } from './terminal-ws.ts';
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
export { RateLimiter, type RateLimiterConfig, type RateLimitResult } from './rate-limiter.ts';
export { type RouteHandler, type RouteParams, Router } from './router.ts';
export { createActivityRoute } from './routes/activity.ts';
export { createAgentRoutes } from './routes/agents.ts';
export { createAuthRoutes } from './routes/auth.ts';
export { createBackendRoutes } from './routes/backends.ts';
export { createConfigRoutes } from './routes/config.ts';
export { createCronRoutes } from './routes/crons.ts';
export { createHealthRoute } from './routes/health.ts';
export { createInstanceRoutes } from './routes/instances.ts';
export { createMemoryRoutes } from './routes/memory.ts';
export { createSessionRoutes } from './routes/sessions.ts';
export { createUsageRoutes } from './routes/usage.ts';
export { SessionStore } from './session-store.ts';
export { createWebSocketHandler, type WSData } from './websocket.ts';

// --- Bootstrap (only when run directly) ---

const stubProvider = new StubEmbeddingProvider();
const stubEmbedder = (texts: string[]) => stubProvider.embed(texts);

// --- Combined WS data type for Bun.serve ---

type CombinedWSData = (WSData & { type: 'chat' }) | DebugWSData | TerminalWSData;

async function main() {
  const startTime = Date.now();
  const config = parseEnvConfig();
  const logger = new Logger({ level: config.LOG_LEVEL, context: { source: 'server' } });
  const configManager = new ConfigManager(config);
  configManager.initialize();
  const env = typeof Bun !== 'undefined' ? Bun.env : process.env;
  const debugWsEnabled = env.ENABLE_DEBUG_WS !== 'false';
  const debugWsToken = env.DEBUG_WS_TOKEN;

  logger.info('Server starting', { port: config.PORT, backend: config.AI_BACKEND });

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
  const sessionStore = new SessionStore(controlPlaneDb);
  const agentStore = new AgentStore(controlPlaneDb);
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
  logger.info('Control plane initialized', { auth: config.AUTH_ENABLED });

  // Initialize Memory (uses MemoryClient if MEMORY_URL is set, otherwise embedded)
  const memory = createMemory({
    dataDir: config.DATA_DIR,
    vectorProvider: config.VECTOR_PROVIDER,
    qdrantUrl: config.QDRANT_URL,
    embedder: stubEmbedder,
    memoryUrl: config.MEMORY_URL,
  });
  await memory.initialize();
  logger.info('Memory initialized');
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.MEMORY,
      level: DebugEventLevel.INFO,
      source: 'memory.init',
      message: 'Memory system initialized',
    }),
  );

  // Initialize Plugin System
  const hookRegistry = new HookRegistry({
    onError: (hookType, pluginId, error) => {
      logger.warn('Plugin hook error', { hookType, pluginId, error: error.message });
      debugBus.emit(
        makeDebugEvent({
          category: DebugEventCategory.SYSTEM,
          level: DebugEventLevel.WARN,
          source: 'plugin.hook_error',
          message: `Hook "${hookType}" error in plugin "${pluginId ?? 'unknown'}": ${error.message}`,
        }),
      );
    },
  });
  const pluginManager = new PluginManager(hookRegistry);
  logger.info('Plugin system initialized');
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
  const workspaceDir = join(config.DATA_DIR, 'workspaces');
  mkdirSync(workspaceDir, { recursive: true });
  const pool = new AgentPool(registry, {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    hookRegistry,
    store: agentStore,
    workspaceDir,
  });
  logger.info('Agent pool created', {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
  });
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.AGENT,
      level: DebugEventLevel.INFO,
      source: 'agent-pool.init',
      message: `Agent pool created (max=${config.MAX_AGENTS}, idleTimeout=${config.IDLE_TIMEOUT_MS}ms)`,
    }),
  );

  // Restore persisted agents from SQLite
  await pool.restore();
  logger.info('Persisted agents restored');

  // Initialize Conductor (with default backend for direct AI responses)
  const conductor = new Conductor(pool, memory, registry.getDefault(), {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    hookRegistry,
  });
  await conductor.initialize();
  logger.info('Conductor initialized');
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.CONDUCTOR,
      level: DebugEventLevel.INFO,
      source: 'conductor.init',
      message: 'Conductor initialized',
    }),
  );

  // Seed pre-configured agents (idempotent)
  await runSeeds(pool, agentStore);
  logger.info('Agent seeds applied');

  // Initialize CronManager
  const cronManager = new CronManager(conductor, { dataDir: config.DATA_DIR });
  await cronManager.initialize();
  logger.info('CronManager initialized');

  // Register instance with live heartbeat callback
  instanceRegistry.register(config.PORT, '0.0.0', async () => {
    let memoryStatus = 'ok';
    try {
      await memory.stats();
    } catch {
      memoryStatus = 'error';
    }
    return { agentCount: pool.list().length, memoryStatus };
  });
  logger.info('Instance registered');

  // Initialize Rate Limiter
  const rateLimiter = new RateLimiter({
    maxRequests: config.RATE_LIMIT_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    trustProxy: config.TRUST_PROXY,
  });
  logger.info('Rate limiter initialized', {
    maxRequests: config.RATE_LIMIT_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    trustProxy: config.TRUST_PROXY,
  });

  // Create WebSocket handlers
  const ws = createWebSocketHandler(
    conductor,
    debugBus,
    sessionStore,
    config.STREAM_TIMEOUT_MS,
    registry,
  );
  const debugWs = createDebugWebSocketHandler(debugBus);
  const terminalWs = createTerminalWebSocketHandler();
  if (debugWsEnabled) {
    logger.info('Debug WebSocket enabled', { path: '/ws/debug', tokenProtected: !!debugWsToken });
  }

  // Build HTTP router
  const router = new Router();

  const healthRoute = createHealthRoute(conductor, memory, startTime);
  const agentRoutes = createAgentRoutes(conductor, pool);
  const memoryRoutes = createMemoryRoutes(memory);
  const cronRoutes = createCronRoutes(cronManager);
  const activityRoute = createActivityRoute(conductor);
  const configRoutes = createConfigRoutes(configManager);
  const backendRoutes = createBackendRoutes(registry);
  const authRoutes = createAuthRoutes(authStore, authMiddleware);
  const usageRoutes = createUsageRoutes(usageStore, authMiddleware);
  const instanceRoutes = createInstanceRoutes(instanceRegistry);
  const sessionRoutes = createSessionRoutes(sessionStore, memory);

  router.get('/health', healthRoute);

  router.get('/api/agents', agentRoutes.list);
  router.post('/api/agents', agentRoutes.create);
  router.put('/api/agents/:id', agentRoutes.update);
  router.delete('/api/agents/:id', agentRoutes.remove);
  router.post('/api/agents/:id/restart', agentRoutes.restart);

  router.get('/api/memory/search', memoryRoutes.search);
  router.post('/api/memory/ingest', memoryRoutes.ingest);
  router.post('/api/memory/ingest/file', memoryRoutes.ingestFile);
  router.get('/api/memory/stats', memoryRoutes.stats);

  router.get('/api/crons', cronRoutes.list);
  router.post('/api/crons', cronRoutes.create);
  router.put('/api/crons/:id', cronRoutes.update);
  router.delete('/api/crons/:id', cronRoutes.remove);
  router.post('/api/crons/:id/trigger', cronRoutes.trigger);

  router.get('/api/activity', activityRoute);

  router.get('/api/config', configRoutes.get);
  router.put('/api/config', configRoutes.update);

  // Backend routes
  router.get('/api/backends/status', backendRoutes.status);
  router.get('/api/backends/options', backendRoutes.options);
  router.put('/api/backends/api-key', backendRoutes.updateApiKey);
  router.post('/api/backends/claude/logout', backendRoutes.claudeLogout);

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
  router.delete('/api/instances/:id', instanceRoutes.remove);

  // Session routes
  router.get('/api/sessions', sessionRoutes.list);
  router.post('/api/sessions', sessionRoutes.create);
  router.get('/api/sessions/:id', sessionRoutes.get);
  router.put('/api/sessions/:id', sessionRoutes.update);
  router.delete('/api/sessions/:id', sessionRoutes.remove);

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
  // idleTimeout: 0 disables Bun's automatic request timeout (default 10s).
  // Required for long-lived streaming responses like the OAuth login flow.
  const server = Bun.serve<CombinedWSData>({
    port: config.PORT,
    idleTimeout: 0,

    async fetch(req, server) {
      const url = new URL(req.url);

      // Rate limit check (before auth, applies to all paths except /health)
      const rlResult = rateLimiter.check(req, server);
      if (!rlResult.allowed) return rateLimiter.toResponse(rlResult);

      // Chat WebSocket upgrade (with auth support via query token)
      if (url.pathname === '/ws/chat') {
        // Auth for WS: check token query param if auth enabled
        if (config.AUTH_ENABLED) {
          const wsAuthResult = authMiddleware.authenticate(req);
          if (wsAuthResult instanceof Response) return wsAuthResult;
        }

        // Session support: parse ?sessionId= from URL
        // If no sessionId, session is created lazily on first message (see websocket.ts)
        const sessionId = url.searchParams.get('sessionId') ?? undefined;
        if (sessionId) {
          // Verify session exists
          const session = sessionStore.getById(sessionId);
          if (!session) {
            return new Response('Session not found', { status: 404 });
          }
        }

        const upgraded = server.upgrade(req, {
          data: { id: crypto.randomUUID(), type: 'chat' as const, sessionId },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Terminal WebSocket upgrade (for PTY-based CLI login)
      if (url.pathname === '/ws/terminal') {
        if (config.AUTH_ENABLED) {
          const wsAuthResult = authMiddleware.authenticate(req);
          if (wsAuthResult instanceof Response) return wsAuthResult;
        }
        const upgraded = server.upgrade(req, {
          data: { id: crypto.randomUUID(), type: 'terminal' as const },
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

      return rateLimiter.addHeaders(response, rlResult);
    },

    websocket: {
      open(socket: ServerWebSocket<CombinedWSData>) {
        if (socket.data.type === 'terminal') {
          terminalWs.handler.open(socket as ServerWebSocket<TerminalWSData>);
        } else if (socket.data.type === 'debug') {
          debugWs.handler.open(socket as ServerWebSocket<DebugWSData>);
        } else {
          ws.handler.open(socket as ServerWebSocket<WSData>);
        }
      },
      async message(socket: ServerWebSocket<CombinedWSData>, raw: string | Buffer) {
        if (socket.data.type === 'terminal') {
          terminalWs.handler.message(socket as ServerWebSocket<TerminalWSData>, raw);
        } else if (socket.data.type === 'debug') {
          debugWs.handler.message(socket as ServerWebSocket<DebugWSData>, raw);
        } else {
          await ws.handler.message(socket as ServerWebSocket<WSData>, raw);
        }
      },
      close(socket: ServerWebSocket<CombinedWSData>) {
        if (socket.data.type === 'terminal') {
          terminalWs.handler.close(socket as ServerWebSocket<TerminalWSData>);
        } else if (socket.data.type === 'debug') {
          debugWs.handler.close(socket as ServerWebSocket<DebugWSData>);
        } else {
          ws.handler.close(socket as ServerWebSocket<WSData>);
        }
      },
    },
  });

  logger.info('Server listening', { port: server.port, url: `http://localhost:${server.port}` });
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
    logger.warn('Server shutting down');
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
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run main when this is the entry point
const isMainModule = typeof Bun !== 'undefined' && Bun.main === import.meta.path;

if (isMainModule) {
  main().catch((error) => {
    const fatalLogger = new Logger({ level: 'error', context: { source: 'server' } });
    fatalLogger.error('Fatal error', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
