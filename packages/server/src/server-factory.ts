/**
 * Factory functions for server subsystem initialization.
 * Extracted from main() to reduce its size while keeping it a readable composition root.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
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
import { type AIBackend, DebugEventCategory, DebugEventLevel, type Logger } from '@autonomy/shared';
import type { MemoryClient } from '@pyxmate/memory';
import { AgentStore } from './agent-store.ts';
import type { parseEnvConfig } from './config.ts';
import type { DebugBus } from './debug-bus.ts';
import { makeDebugEvent } from './debug-bus.ts';
import type { DisabledMemory } from './disabled-memory.ts';
import { runCronSeeds, runSeeds } from './seeds/index.ts';
import { SessionStore } from './session-store.ts';

type EnvConfig = ReturnType<typeof parseEnvConfig>;

// ── Runtime Database ────────────────────────────────────────────────────────

interface RuntimeDatabaseDeps {
  db: Database;
  sessionStore: SessionStore;
  agentStore: AgentStore;
}

export function initRuntimeDatabase(config: EnvConfig, logger: Logger): RuntimeDatabaseDeps {
  if (!existsSync(config.DATA_DIR)) {
    mkdirSync(config.DATA_DIR, { recursive: true });
  }
  for (const subdir of ['claude', 'codex', 'gemini', 'pi']) {
    const cliConfigDir = join(config.DATA_DIR, 'cli-config', subdir);
    if (!existsSync(cliConfigDir)) {
      mkdirSync(cliConfigDir, { recursive: true });
    }
  }
  const db = new Database(join(config.DATA_DIR, 'runtime.sqlite'));
  db.exec('PRAGMA journal_mode = WAL;');
  const sessionStore = new SessionStore(db);
  const agentStore = new AgentStore(db);
  logger.info('Runtime database initialized');
  return { db, sessionStore, agentStore };
}

// ── Backend Registry ────────────────────────────────────────────────────────

export function initBackendRegistry(defaultBackend: AIBackend): DefaultBackendRegistry {
  const registry = new DefaultBackendRegistry(defaultBackend);
  registry.register(new ClaudeBackend());
  registry.register(new CodexBackend());
  registry.register(new GeminiBackend());
  registry.register(new PiBackend());
  registry.register(new OllamaBackend());
  return registry;
}

// ── Plugin System ───────────────────────────────────────────────────────────

interface PluginDeps {
  hookRegistry: HookRegistry;
  pluginManager: PluginManager;
}

export function initPluginSystem(logger: Logger, debugBus: DebugBus): PluginDeps {
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
  return { hookRegistry, pluginManager };
}

// ── Agent Pool ──────────────────────────────────────────────────────────────

interface AgentPoolDeps {
  config: EnvConfig;
  registry: DefaultBackendRegistry;
  hookRegistry: HookRegistry;
  agentStore: AgentStore;
  logger: Logger;
  debugBus: DebugBus;
}

export async function initAgentPool(deps: AgentPoolDeps): Promise<AgentPool> {
  const { config, registry, hookRegistry, agentStore, logger, debugBus } = deps;
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
  return pool;
}

// ── Conductor & Cron ────────────────────────────────────────────────────────

interface ConductorDeps {
  conductor: Conductor;
  cronManager: CronManager;
}

interface ConductorInitDeps {
  config: EnvConfig;
  pool: AgentPool;
  memory: MemoryClient | DisabledMemory;
  registry: DefaultBackendRegistry;
  hookRegistry: HookRegistry;
  agentStore: AgentStore;
  logger: Logger;
  debugBus: DebugBus;
}

export async function initConductor(deps: ConductorInitDeps): Promise<ConductorDeps> {
  const { config, pool, memory, registry, hookRegistry, agentStore, logger, debugBus } = deps;
  const fallbackBackend = config.FALLBACK_BACKEND
    ? registry.get(config.FALLBACK_BACKEND)
    : undefined;
  if (fallbackBackend) {
    logger.info('Fallback backend configured', { fallback: config.FALLBACK_BACKEND });
  }

  const conductor = new Conductor(pool, memory, registry.getDefault(), {
    maxAgents: config.MAX_AGENTS,
    idleTimeoutMs: config.IDLE_TIMEOUT_MS,
    hookRegistry,
    fallbackBackend,
    llmApiKey: config.ANTHROPIC_API_KEY,
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

  return { conductor, cronManager };
}
