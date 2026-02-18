import type { AgentDefinition, AgentId, AgentRuntimeInfo } from '@autonomy/shared';
import { DEFAULTS } from '@autonomy/shared';
import { AgentProcess } from './agent-process.ts';
import type { BackendRegistry } from './backends/registry.ts';
import type { CLIBackend } from './backends/types.ts';
import { AgentManagerError, AgentNotFoundError, MaxAgentsReachedError } from './errors.ts';

export interface AgentPoolOptions {
  maxAgents?: number;
  idleTimeoutMs?: number;
}

export class AgentPool {
  private agents = new Map<AgentId, AgentProcess>();
  private backend: CLIBackend | BackendRegistry;
  private maxAgents: number;
  private idleTimeoutMs: number;

  constructor(backend: CLIBackend | BackendRegistry, options?: AgentPoolOptions) {
    this.backend = backend;
    this.maxAgents = options?.maxAgents ?? DEFAULTS.MAX_AGENTS;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 0;
  }

  async create(definition: AgentDefinition): Promise<AgentProcess> {
    if (this.agents.has(definition.id)) {
      throw new AgentManagerError(`Agent "${definition.id}" already exists`);
    }
    if (this.agents.size >= this.maxAgents) {
      throw new MaxAgentsReachedError(this.maxAgents);
    }

    const resolved = this.resolveBackend(definition);
    const agent = new AgentProcess(definition, resolved, {
      idleTimeoutMs: this.idleTimeoutMs,
    });
    await agent.start();
    this.agents.set(definition.id, agent);
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
    const agent = new AgentProcess(merged, resolved, {
      idleTimeoutMs: this.idleTimeoutMs,
    });

    try {
      await agent.start();
    } catch (err) {
      // Restart old agent to avoid losing the agent entirely
      try {
        await existing.start();
        this.agents.set(id, existing);
      } catch {
        // Old agent also failed to restart — remove from pool
        this.agents.delete(id);
      }
      throw err;
    }

    this.agents.set(id, agent);
    return agent;
  }

  async remove(id: AgentId): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) return;
    await agent.stop();
    this.agents.delete(id);
  }

  async sendMessage(id: AgentId, message: string): Promise<string> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }
    return agent.sendMessage(message);
  }

  async shutdown(): Promise<void> {
    const stopPromises = [...this.agents.values()].map((a) => a.stop());
    await Promise.all(stopPromises);
    this.agents.clear();
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
