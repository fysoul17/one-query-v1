// @autonomy/server — Bun.serve HTTP/WS entry point

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import {
  AgentPool,
  ClaudeBackend,
  CodexBackend,
  DefaultBackendRegistry,
  GeminiBackend,
  OllamaBackend,
  PiBackend,
} from '@autonomy/agent-manager';
import { Conductor } from '@autonomy/conductor';
import { CronManager } from '@autonomy/cron-manager';
import { HookRegistry, PluginManager } from '@autonomy/plugin-system';
import { DebugEventCategory, DebugEventLevel, getErrorDetail, Logger } from '@autonomy/shared';
import { MemoryClient } from '@pyx-memory/client';
import type { ServerWebSocket } from 'bun';
import { AgentStore } from './agent-store.ts';
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
import { runCronSeeds, runSeeds } from './seeds/index.ts';
import { SessionStore } from './session-store.ts';
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

function startMemoryLifecycle(
  memory: MemoryClient | DisabledMemory,
  logger: Logger,
): ReturnType<typeof setInterval>[] {
  const intervals: ReturnType<typeof setInterval>[] = [];
  if (!isExtended(memory)) return intervals;

  let consolidating = false;
  let decaying = false;

  intervals.push(
    setInterval(
      async () => {
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
      },
      30 * 60 * 1000,
    ),
  );

  intervals.push(
    setInterval(
      async () => {
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
      },
      24 * 60 * 60 * 1000,
    ),
  );

  logger.info('Memory lifecycle timers registered (consolidation: 30m, decay: 24h)');
  return intervals;
}

async function initMemory(
  memoryUrl: string | undefined,
  logger: Logger,
): Promise<MemoryClient | DisabledMemory> {
  if (memoryUrl) {
    const client = new MemoryClient(memoryUrl);
    try {
      await client.initialize();
      logger.info('Memory connected', { url: memoryUrl });
      return client;
    } catch (error) {
      logger.warn('Memory server unreachable — running without memory', {
        error: getErrorDetail(error),
        url: memoryUrl,
      });
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

  // Initialize Runtime Database (SQLite for sessions, agents)
  const { mkdirSync, existsSync } = await import('node:fs');
  if (!existsSync(config.DATA_DIR)) {
    mkdirSync(config.DATA_DIR, { recursive: true });
  }
  for (const subdir of ['claude', 'codex', 'gemini', 'pi']) {
    const cliConfigDir = join(config.DATA_DIR, 'cli-config', subdir);
    if (!existsSync(cliConfigDir)) {
      mkdirSync(cliConfigDir, { recursive: true });
    }
  }
  const runtimeDb = new Database(join(config.DATA_DIR, 'runtime.sqlite'));
  runtimeDb.exec('PRAGMA journal_mode = WAL;');
  const sessionStore = new SessionStore(runtimeDb);
  const agentStore = new AgentStore(runtimeDb);
  logger.info('Runtime database initialized');

  // Initialize Backend Registry
  const registry = new DefaultBackendRegistry(config.AI_BACKEND);
  registry.register(new ClaudeBackend());
  registry.register(new CodexBackend());
  registry.register(new GeminiBackend());
  registry.register(new PiBackend());
  registry.register(new OllamaBackend());

  // Initialize Memory
  const memory = await initMemory(config.MEMORY_URL, logger);
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

  // Initialize Agent Pool
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

  await pool.restore();
  logger.info('Persisted agents restored');

  // Resolve fallback backend
  const fallbackBackend = config.FALLBACK_BACKEND
    ? registry.get(config.FALLBACK_BACKEND)
    : undefined;
  if (fallbackBackend) {
    logger.info('Fallback backend configured', { fallback: config.FALLBACK_BACKEND });
  }

  // Initialize Conductor
  const conductor = new Conductor(pool, memory, registry.getDefault(), {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    hookRegistry,
    fallbackBackend,
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

  // Seed agents and crons
  await runSeeds(pool, agentStore);
  await pool.restore();
  logger.info('Agent seeds applied');

  const cronManager = new CronManager(conductor, { dataDir: config.DATA_DIR });
  await cronManager.initialize();
  conductor.setCronManager(cronManager);
  logger.info('CronManager initialized');

  await runCronSeeds(cronManager);
  logger.info('Cron seeds applied');

  // Memory lifecycle timers
  const lifecycleIntervals = startMemoryLifecycle(memory, logger);

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
