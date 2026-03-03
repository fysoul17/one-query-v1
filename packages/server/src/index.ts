// @autonomy/server — Bun.serve HTTP/WS entry point

import type { AgentPool, DefaultBackendRegistry } from '@autonomy/agent-manager';
import type { Conductor } from '@autonomy/conductor';
import type { CronManager } from '@autonomy/cron-manager';
import { DebugEventCategory, DebugEventLevel, getErrorDetail, Logger } from '@autonomy/shared';
import { MemoryClient } from '@pyx-memory/client';
import type { ServerWebSocket } from 'bun';
import { parseEnvConfig } from './config.ts';
import { ConfigManager } from './config-manager.ts';
import { DebugBus, makeDebugEvent } from './debug-bus.ts';
import { createDebugWebSocketHandler, type DebugWSData } from './debug-websocket.ts';
import { DisabledMemory } from './disabled-memory.ts';
import { RateLimiter } from './rate-limiter.ts';
import { Router } from './router.ts';
import { createActivityRoute } from './routes/activity.ts';
import { createAgentRoutes } from './routes/agents.ts';
import { createBackendRoutes } from './routes/backends.ts';
import { createConfigRoutes } from './routes/config.ts';
import { createCronRoutes } from './routes/crons.ts';
import { createGraphRoutes } from './routes/graph.ts';
import { createHealthRoute } from './routes/health.ts';
import { createLifecycleRoutes, isExtended } from './routes/lifecycle.ts';
import { createMemoryRoutes } from './routes/memory.ts';
import { createSessionRoutes } from './routes/sessions.ts';
import { SecretStore } from './secret-store.ts';
import {
  initAgentPool,
  initBackendRegistry,
  initConductor,
  initPluginSystem,
  initRuntimeDatabase,
} from './server-factory.ts';
import type { SessionStore } from './session-store.ts';
import { createTerminalWebSocketHandler, type TerminalWSData } from './terminal-ws.ts';
import { createWebSocketHandler, type WSData } from './websocket.ts';

// --- Bootstrap (only when run directly) ---

// --- Combined WS data type for Bun.serve ---

type CombinedWSData = (WSData & { type: 'chat' }) | DebugWSData | TerminalWSData;

interface RouteDeps {
  conductor: Conductor;
  pool: AgentPool;
  memory: MemoryClient | DisabledMemory;
  cronManager: CronManager;
  configManager: ConfigManager;
  registry: DefaultBackendRegistry;
  secretStore: SecretStore;
  sessionStore: SessionStore;
  startTime: number;
  enableAdvancedMemory: boolean;
}

function registerRoutes(router: Router, deps: RouteDeps): void {
  const healthRoute = createHealthRoute(deps.conductor, deps.memory, deps.startTime, deps.registry);
  const agentRoutes = createAgentRoutes(deps.conductor, deps.pool);
  const memoryRoutes = createMemoryRoutes(deps.memory);
  const lifecycleRoutes = createLifecycleRoutes(deps.memory, deps.enableAdvancedMemory);
  const graphRoutes = createGraphRoutes(deps.memory);
  const cronRoutes = createCronRoutes(deps.cronManager);
  const activityRoute = createActivityRoute(deps.conductor);
  const configRoutes = createConfigRoutes(deps.configManager);
  const backendRoutes = createBackendRoutes(deps.registry, deps.secretStore);
  const sessionRoutes = createSessionRoutes(deps.sessionStore, deps.memory);

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
  router.get('/api/memory/entries', memoryRoutes.entries);
  router.get('/api/memory/entries/:id', memoryRoutes.getEntry);
  router.delete('/api/memory/entries/:id', memoryRoutes.deleteEntry);

  router.delete('/api/memory/sessions/:sessionId', memoryRoutes.clearSession);

  router.post('/api/memory/consolidate', lifecycleRoutes.consolidate);
  router.post('/api/memory/forget/:id', lifecycleRoutes.forget);
  router.post('/api/memory/sessions/:sessionId/summarize', lifecycleRoutes.summarizeSession);
  router.post('/api/memory/decay', lifecycleRoutes.decay);
  router.post('/api/memory/reindex', lifecycleRoutes.reindex);
  router.delete('/api/memory/source/:source', lifecycleRoutes.deleteBySource);
  router.get('/api/memory/graph/nodes', graphRoutes.getNodes);
  router.get('/api/memory/graph/edges', graphRoutes.getEdges);
  router.post('/api/memory/graph/query', graphRoutes.query);

  router.get('/api/crons', cronRoutes.list);
  router.get('/api/crons/logs', cronRoutes.logs);
  router.post('/api/crons', cronRoutes.create);
  router.put('/api/crons/:id', cronRoutes.update);
  router.delete('/api/crons/:id', cronRoutes.remove);
  router.post('/api/crons/:id/trigger', cronRoutes.trigger);

  router.get('/api/activity', activityRoute);

  router.get('/api/config', configRoutes.get);
  router.put('/api/config', configRoutes.update);

  router.get('/api/backends/status', backendRoutes.status);
  router.get('/api/backends/options', backendRoutes.options);
  router.put('/api/backends/api-key', (req: Request) => backendRoutes.updateApiKey(req));
  router.put('/api/backends/:name/api-key', (req: Request, params: Record<string, string>) =>
    backendRoutes.updateApiKey(req, params.name),
  );
  router.post('/api/backends/:name/logout', (_req: Request, params: Record<string, string>) =>
    // biome-ignore lint/style/noNonNullAssertion: route pattern guarantees param exists
    backendRoutes.logout(params.name!),
  );

  router.get('/api/sessions', sessionRoutes.list);
  router.post('/api/sessions', sessionRoutes.create);
  router.get('/api/sessions/:id', sessionRoutes.get);
  router.put('/api/sessions/:id', sessionRoutes.update);
  router.delete('/api/sessions/:id', sessionRoutes.remove);
}

const MEMORY_CONSOLIDATION_INTERVAL_MS = 30 * 60 * 1000;
const MEMORY_DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000;

function startMemoryLifecycle(
  memory: MemoryClient | DisabledMemory,
  logger: Logger,
): ReturnType<typeof setInterval>[] {
  const intervals: ReturnType<typeof setInterval>[] = [];
  if (!isExtended(memory)) return intervals;

  let consolidating = false;
  let decaying = false;

  intervals.push(
    setInterval(async () => {
      if (consolidating) return;
      consolidating = true;
      try {
        const result = await memory.consolidate();
        logger.info('Memory consolidation completed', {
          processed: result.entriesProcessed,
          merged: result.entriesMerged,
          archived: result.entriesArchived,
          durationMs: result.durationMs,
        });
      } catch (error) {
        logger.warn('Memory consolidation failed', {
          error: getErrorDetail(error),
        });
      } finally {
        consolidating = false;
      }
    }, MEMORY_CONSOLIDATION_INTERVAL_MS),
  );

  intervals.push(
    setInterval(async () => {
      if (decaying) return;
      decaying = true;
      try {
        const archived = await memory.runDecay();
        logger.info('Memory decay completed', { archived });
      } catch (error) {
        logger.warn('Memory decay failed', {
          error: getErrorDetail(error),
        });
      } finally {
        decaying = false;
      }
    }, MEMORY_DECAY_INTERVAL_MS),
  );

  logger.info('Memory lifecycle timers registered (consolidation: 30m, decay: 24h)');
  return intervals;
}

async function initMemory(
  memoryUrl: string | undefined,
  logger: Logger,
  retries = 5,
  retryDelayMs = 2000,
): Promise<MemoryClient | DisabledMemory> {
  if (memoryUrl) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const client = new MemoryClient(memoryUrl);
      try {
        await client.initialize();
        logger.info('Memory connected', { url: memoryUrl, attempt });
        return client;
      } catch (error) {
        if (attempt < retries) {
          logger.info(`Memory server not ready, retrying in ${retryDelayMs}ms`, {
            attempt,
            maxRetries: retries,
            url: memoryUrl,
          });
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        } else {
          logger.warn('Memory server unreachable after all retries — running without memory', {
            error: getErrorDetail(error),
            url: memoryUrl,
            attempts: retries,
          });
        }
      }
    }
  }
  const disabled = new DisabledMemory();
  await disabled.initialize();
  return disabled;
}

async function main() {
  const startTime = Date.now();
  const config = parseEnvConfig();
  const logger = new Logger({ level: config.LOG_LEVEL, context: { source: 'server' } });
  const configManager = new ConfigManager(config);
  configManager.initialize();
  const secretStore = new SecretStore(config.DATA_DIR);
  secretStore.initialize();
  const env = typeof Bun !== 'undefined' ? Bun.env : process.env;
  const debugWsEnabled = env.ENABLE_DEBUG_WS !== 'false';
  const debugWsToken = env.DEBUG_WS_TOKEN;

  logger.info('Server starting', { port: config.PORT, backend: config.AI_BACKEND });

  const debugBus = new DebugBus(500);
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.SYSTEM,
      level: DebugEventLevel.INFO,
      source: 'server.startup',
      message: 'Server starting',
    }),
  );

  // Initialize subsystems
  const { db: runtimeDb, sessionStore, agentStore } = initRuntimeDatabase(config, logger);
  const registry = initBackendRegistry(config.AI_BACKEND);

  const memory = await initMemory(
    config.MEMORY_URL,
    logger,
    config.MEMORY_RETRY_COUNT,
    config.MEMORY_RETRY_DELAY_MS,
  );
  debugBus.emit(
    makeDebugEvent({
      category: DebugEventCategory.MEMORY,
      level: DebugEventLevel.INFO,
      source: 'memory.init',
      message:
        memory instanceof DisabledMemory
          ? 'Memory disabled — no MEMORY_URL configured'
          : `Memory connected to ${config.MEMORY_URL}`,
    }),
  );

  const { hookRegistry, pluginManager } = initPluginSystem(logger, debugBus);
  const pool = await initAgentPool(config, registry, hookRegistry, agentStore, logger, debugBus);
  const { conductor, cronManager } = await initConductor(
    config,
    pool,
    memory,
    registry,
    hookRegistry,
    agentStore,
    logger,
    debugBus,
  );

  // Memory lifecycle timers
  const lifecycleIntervals = startMemoryLifecycle(memory, logger);

  // Rate limiter
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

  // WebSocket handlers
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

  // HTTP router
  const router = new Router(config.CORS_ORIGIN);
  registerRoutes(router, {
    conductor,
    pool,
    memory,
    cronManager,
    configManager,
    registry,
    secretStore,
    sessionStore,
    startTime,
    enableAdvancedMemory: config.ENABLE_ADVANCED_MEMORY,
  });

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

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: HTTP request dispatch is inherently branchy
    async fetch(req, server) {
      const url = new URL(req.url);

      // Rate limit check (applies to all paths except /health)
      const rlResult = rateLimiter.check(req, server);
      if (!rlResult.allowed) return rateLimiter.toResponse(rlResult);

      // Chat WebSocket upgrade
      if (url.pathname === '/ws/chat') {
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
        if (!config.ENABLE_TERMINAL_WS) {
          return new Response('Terminal WebSocket is disabled', { status: 403 });
        }
        const backend = url.searchParams.get('backend') ?? 'claude';
        const upgraded = server.upgrade(req, {
          data: { id: crypto.randomUUID(), type: 'terminal' as const, backend },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Debug WebSocket upgrade (gated by ENABLE_DEBUG_WS env var)
      if (url.pathname === '/ws/debug') {
        return handleDebugUpgrade(req, server, url) as Response;
      }

      // Route → Response
      const response = await router.handle(req);
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
    for (const interval of lifecycleIntervals) clearInterval(interval);
    ws.shutdown();
    debugWs.shutdown();
    await pluginManager.shutdown();
    await cronManager.shutdown();
    await conductor.shutdown();
    await pool.shutdown();
    await memory.shutdown();
    runtimeDb.close();
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
      error: getErrorDetail(error),
    });
    process.exit(1);
  });
}
