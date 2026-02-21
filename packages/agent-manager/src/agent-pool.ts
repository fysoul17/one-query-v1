import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type {
  AgentDefinition,
  AgentId,
  AgentRuntimeInfo,
  AgentStoreInterface,
  HookRegistryInterface,
  StreamEvent,
} from '@autonomy/shared';
import { DEFAULTS, getErrorDetail, HookName, Logger } from '@autonomy/shared';
import { AgentProcess } from './agent-process.ts';
import type { BackendRegistry } from './backends/registry.ts';
import type { CLIBackend } from './backends/types.ts';
import { AgentManagerError, AgentNotFoundError, MaxAgentsReachedError } from './errors.ts';

export interface AgentPoolOptions {
  maxAgents?: number;
  idleTimeoutMs?: number;
  hookRegistry?: HookRegistryInterface;
  store?: AgentStoreInterface;
  workspaceDir?: string;
}

export class AgentPool {
  private agents = new Map<AgentId, AgentProcess>();
  private backend: CLIBackend | BackendRegistry;
  private maxAgents: number;
  private idleTimeoutMs: number;
  private hookRegistry?: HookRegistryInterface;
  private store?: AgentStoreInterface;
  private workspaceDir?: string;
  private logger = new Logger({ context: { source: 'agent-pool' } });

  constructor(backend: CLIBackend | BackendRegistry, options?: AgentPoolOptions) {
    this.backend = backend;
    this.maxAgents = options?.maxAgents ?? DEFAULTS.MAX_AGENTS;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 0;
    this.hookRegistry = options?.hookRegistry;
    this.store = options?.store;
    this.workspaceDir = options?.workspaceDir;
  }

  async create(definition: AgentDefinition): Promise<AgentProcess> {
    if (this.agents.has(definition.id)) {
      throw new AgentManagerError(`Agent "${definition.id}" already exists`);
    }
    if (this.agents.size >= this.maxAgents) {
      throw new MaxAgentsReachedError(this.maxAgents);
    }

    // Hook: onBeforeAgentCreate — plugins can transform or reject the definition
    let processedDef = definition;
    if (this.hookRegistry) {
      const hookResult = await this.hookRegistry.emitWaterfall(HookName.BEFORE_AGENT_CREATE, {
        definition,
      });
      if (hookResult === null || hookResult === undefined) {
        throw new AgentManagerError(`Agent creation rejected by plugin`);
      }
      if (typeof hookResult === 'object' && 'definition' in hookResult) {
        processedDef = (hookResult as { definition: AgentDefinition }).definition;
      }
    }

    const resolved = this.resolveBackend(processedDef);
    const cwd = this.ensureWorkspace(processedDef.id);
    const agent = new AgentProcess(processedDef, resolved, {
      idleTimeoutMs: this.idleTimeoutMs,
      cwd,
    });
    await agent.start();
    this.agents.set(processedDef.id, agent);
    this.store?.save(processedDef);
    this.logger.info('Agent added to pool', { agentId: processedDef.id, name: processedDef.name });

    // Hook: onAfterAgentCreate — observation only
    if (this.hookRegistry) {
      await this.hookRegistry.emit(HookName.AFTER_AGENT_CREATE, {
        definition: processedDef,
        runtimeInfo: agent.toRuntimeInfo(),
      });
    }

    return agent;
  }

  get(id: AgentId): AgentProcess | undefined {
    return this.agents.get(id);
  }

  list(): AgentRuntimeInfo[] {
    return [...this.agents.values()].map((a) => a.toRuntimeInfo());
  }

  async update(id: AgentId, updates: Partial<AgentDefinition>): Promise<AgentProcess> {
    const existing = this.agents.get(id);
    if (!existing) {
      throw new AgentNotFoundError(id);
    }

    // Merge definition, preserving fields not in updates
    const merged: AgentDefinition = { ...existing.definition, ...updates, id };

    // Stop the old process
    await existing.stop();

    // Resolve backend (may have changed)
    const resolved = this.resolveBackend(merged);
    const cwd = this.ensureWorkspace(id);
    const agent = new AgentProcess(merged, resolved, {
      idleTimeoutMs: this.idleTimeoutMs,
      cwd,
    });

    try {
      await agent.start();
    } catch (err) {
      // Restart old agent to avoid losing the agent entirely
      try {
        await existing.start();
        this.agents.set(id, existing);
      } catch (restartErr) {
        // Old agent also failed to restart — remove from pool
        this.agents.delete(id);
        this.logger.error('Agent update failed and old agent could not restart', {
          agentId: id,
          error: getErrorDetail(restartErr),
        });
      }
      throw err;
    }

    this.agents.set(id, agent);
    this.store?.update(id, merged);
    return agent;
  }

  async remove(id: AgentId): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) return;

    // Hook: onBeforeAgentDelete — plugins can reject deletion
    if (this.hookRegistry) {
      const hookResult = await this.hookRegistry.emitWaterfall(HookName.BEFORE_AGENT_DELETE, {
        agentId: id,
      });
      if (hookResult === null || hookResult === undefined) {
        return; // Deletion rejected by plugin — silently skip
      }
    }

    await agent.stop();
    this.agents.delete(id);
    this.store?.delete(id);
    this.logger.info('Agent removed from pool', { agentId: id });
  }

  async sendMessage(id: AgentId, message: string): Promise<string> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }
    return agent.sendMessage(message);
  }

  async *sendMessageStreaming(
    id: AgentId,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }
    yield* agent.sendMessageStreaming(message, signal);
  }

  async shutdown(): Promise<void> {
    const stopPromises = [...this.agents.values()].map((a) => a.stop());
    await Promise.all(stopPromises);
    this.agents.clear();
  }

  async restore(): Promise<void> {
    if (!this.store) return;
    const definitions = this.store.list().filter((def) => !this.agents.has(def.id));
    const results = await Promise.allSettled(
      definitions.map(async (def) => {
        const resolved = this.resolveBackend(def);
        const cwd = this.ensureWorkspace(def.id);
        const agent = new AgentProcess(def, resolved, {
          idleTimeoutMs: this.idleTimeoutMs,
          cwd,
        });
        await agent.start();
        return agent;
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const def = definitions[i];
      if (result.status === 'fulfilled') {
        const agent = result.value;
        this.agents.set(def.id, agent);
        this.logger.info('Agent restored from store', { agentId: def.id, name: def.name });
      } else {
        this.logger.error('Failed to restore agent', {
          agentId: def.id,
          error: getErrorDetail(result.reason),
        });
      }
    }
  }

  private ensureWorkspace(agentId: AgentId): string | undefined {
    if (!this.workspaceDir) return undefined;
    const dir = resolve(this.workspaceDir, agentId);
    // Guard against path traversal (e.g. agentId = "../../etc")
    if (!dir.startsWith(this.workspaceDir + sep)) {
      throw new AgentManagerError(`Invalid agentId for workspace: ${agentId}`);
    }
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private resolveBackend(definition: AgentDefinition): CLIBackend {
    if (this.isRegistry(this.backend)) {
      if (definition.backend) {
        return this.backend.get(definition.backend);
      }
      return this.backend.getDefault();
    }
    return this.backend;
  }

  private isRegistry(backend: CLIBackend | BackendRegistry): backend is BackendRegistry {
    return 'getDefault' in backend && 'list' in backend;
  }
}
