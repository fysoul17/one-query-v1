import type { AgentPool } from '@autonomy/agent-manager';
import type { Memory } from '@autonomy/memory';
import {
  type ActivityEntry,
  ActivityType,
  type AgentDefinition,
  type AgentId,
  AgentOwner,
  type AgentRuntimeInfo,
  ConductorAction,
  type ConductorDecision,
  type MemorySearchResult,
  MemoryType,
} from '@autonomy/shared';
import { nanoid } from 'nanoid';
import { ActivityLog } from './activity-log.ts';
import { ConductorNotInitializedError, DelegationError } from './errors.ts';
import { PermissionChecker } from './permissions.ts';
import { RouterManager } from './router.ts';
import type {
  ConductorOptions,
  ConductorResponse,
  DelegationPipelineResult,
  DelegationStep,
  IncomingMessage,
  RouterFn,
  RoutingResult,
} from './types.ts';

export class Conductor {
  private pool: AgentPool;
  private memory: Memory;
  private routerManager = new RouterManager();
  private permissions = new PermissionChecker();
  private activityLog: ActivityLog;
  private initialized = false;

  constructor(pool: AgentPool, memory: Memory, options?: ConductorOptions) {
    this.pool = pool;
    this.memory = memory;
    this.activityLog = new ActivityLog(options?.maxActivityLogSize);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.activityLog.record(ActivityType.MESSAGE, 'Conductor initialized');
  }

  async handleMessage(message: IncomingMessage): Promise<ConductorResponse> {
    this.ensureInitialized();
    const decisions: ConductorDecision[] = [];

    // 1. Search memory for context (non-fatal)
    const memoryContext = await this.searchMemoryContext(message);

    // 2. Route via RouterManager
    const agents = this.pool.list();
    const routingResult = await this.routerManager.route(message, agents, memoryContext);

    decisions.push({
      timestamp: new Date().toISOString(),
      action: 'route',
      reason: routingResult.reason,
    });

    // 3. Dispatch to appropriate handler
    const responseContent = await this.dispatch(routingResult, message, memoryContext, decisions);

    // 4. Store conversation in memory (non-fatal)
    await this.storeConversation(message, responseContent, decisions);

    this.activityLog.record(
      ActivityType.MESSAGE,
      `Handled message from "${message.senderName}"`,
      undefined,
      { senderId: message.senderId, agentCount: routingResult.agentIds.length },
    );

    return {
      content: responseContent,
      agentId: routingResult.agentIds[0],
      decisions,
    };
  }

  async createAgent(params: {
    name: string;
    role: string;
    systemPrompt: string;
    tools?: string[];
    persistent?: boolean;
  }): Promise<AgentRuntimeInfo> {
    this.ensureInitialized();

    const id = nanoid();
    const definition: AgentDefinition = {
      id,
      name: params.name,
      role: params.role,
      tools: params.tools ?? [],
      canModifyFiles: false,
      canDelegateToAgents: false,
      maxConcurrent: 1,
      owner: AgentOwner.CONDUCTOR,
      persistent: params.persistent ?? false,
      createdBy: 'conductor',
      createdAt: new Date().toISOString(),
      systemPrompt: params.systemPrompt,
    };

    const process = await this.pool.create(definition);
    this.activityLog.record(ActivityType.AGENT_CREATED, `Created agent "${params.name}"`, id);

    return process.toRuntimeInfo();
  }

  async deleteAgent(agentId: AgentId): Promise<void> {
    this.ensureInitialized();

    const agent = this.pool.get(agentId);
    if (!agent) return;

    const target = this.permissions.resolveTarget(agent.definition.owner);
    this.permissions.enforce(target, ConductorAction.DELETE);

    await this.pool.remove(agentId);
    this.activityLog.record(ActivityType.AGENT_DELETED, `Deleted agent "${agentId}"`, agentId);
  }

  listAgents(): AgentRuntimeInfo[] {
    this.ensureInitialized();
    return this.pool.list();
  }

  async sendToAgent(agentId: AgentId, message: string): Promise<string> {
    this.ensureInitialized();
    const result = await this.pool.sendMessage(agentId, message);
    this.activityLog.record(
      ActivityType.DELEGATION,
      `Direct message to agent "${agentId}"`,
      agentId,
    );
    return result;
  }

  setRouter(fn: RouterFn): void {
    this.routerManager.setRouter(fn);
  }

  resetRouter(): void {
    this.routerManager.resetRouter();
  }

  getActivity(limit?: number): ActivityEntry[] {
    return this.activityLog.getRecent(limit);
  }

  getAgentActivity(agentId: AgentId, limit?: number): ActivityEntry[] {
    return this.activityLog.getByAgent(agentId, limit);
  }

  async shutdown(): Promise<void> {
    this.activityLog.record(ActivityType.MESSAGE, 'Conductor shutting down');
    this.initialized = false;
  }

  private async searchMemoryContext(message: IncomingMessage): Promise<MemorySearchResult | null> {
    try {
      return await this.memory.search({
        query: message.content,
        limit: 5,
        ...(message.sessionId ? { agentId: message.senderId } : {}),
      });
    } catch {
      // Memory failures are non-fatal
      return null;
    }
  }

  private async dispatch(
    routingResult: RoutingResult,
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
    decisions: ConductorDecision[],
  ): Promise<string> {
    if (routingResult.createAgent) {
      return this.dispatchCreateAgent(routingResult, message, memoryContext, decisions);
    }

    if (routingResult.agentIds.length === 1) {
      const agentId = routingResult.agentIds[0] as string;
      const result = await this.delegateToAgent(agentId, message, memoryContext);
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'delegate',
        targetAgentId: agentId,
        reason: `Delegated to agent "${agentId}"`,
      });
      return result;
    }

    if (routingResult.agentIds.length > 1) {
      const steps: DelegationStep[] = routingResult.agentIds.map((id) => ({
        agentId: id,
        task: message.content,
      }));
      const pipelineResult = await this.executePipeline(steps);
      for (const step of pipelineResult.steps) {
        decisions.push({
          timestamp: new Date().toISOString(),
          action: 'delegate',
          targetAgentId: step.agentId,
          reason: step.success ? 'Pipeline step succeeded' : `Pipeline step failed: ${step.error}`,
        });
      }
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'synthesize',
        reason: `Synthesized results from ${pipelineResult.steps.length} agents`,
      });
      return pipelineResult.finalResult;
    }

    return 'No agents available to handle this request.';
  }

  private async dispatchCreateAgent(
    routingResult: RoutingResult,
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
    decisions: ConductorDecision[],
  ): Promise<string> {
    const create = routingResult.createAgent as NonNullable<RoutingResult['createAgent']>;
    const newAgentId = nanoid();
    const definition: AgentDefinition = {
      id: newAgentId,
      name: create.name,
      role: create.role,
      tools: [],
      canModifyFiles: false,
      canDelegateToAgents: false,
      maxConcurrent: 1,
      owner: AgentOwner.CONDUCTOR,
      persistent: false,
      createdBy: 'conductor',
      createdAt: new Date().toISOString(),
      systemPrompt: create.systemPrompt,
    };

    await this.pool.create(definition);
    this.activityLog.record(
      ActivityType.AGENT_CREATED,
      `Created agent "${definition.name}"`,
      newAgentId,
    );
    decisions.push({
      timestamp: new Date().toISOString(),
      action: 'create_agent',
      targetAgentId: newAgentId,
      reason: `Created agent "${definition.name}" for task`,
    });

    const result = await this.delegateToAgent(newAgentId, message, memoryContext);
    decisions.push({
      timestamp: new Date().toISOString(),
      action: 'delegate',
      targetAgentId: newAgentId,
      reason: `Delegated to newly created agent "${definition.name}"`,
    });
    return result;
  }

  private async storeConversation(
    message: IncomingMessage,
    _responseContent: string,
    decisions: ConductorDecision[],
  ): Promise<void> {
    try {
      await this.memory.store({
        content: message.content,
        type: MemoryType.SHORT_TERM,
        agentId: message.senderId,
        sessionId: message.sessionId,
        metadata: { senderName: message.senderName },
      });
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'store_memory',
        reason: 'Stored conversation in memory',
      });
    } catch {
      // Memory store failures are non-fatal
    }
  }

  private async delegateToAgent(
    agentId: AgentId,
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
  ): Promise<string> {
    // Augment message with memory context
    let augmentedMessage = message.content;
    if (memoryContext && memoryContext.entries.length > 0) {
      const contextSnippet = memoryContext.entries
        .slice(0, 3)
        .map((e) => e.content)
        .join('\n---\n');
      augmentedMessage = `Context from memory:\n${contextSnippet}\n\n---\nUser message: ${message.content}`;
    }

    try {
      const result = await this.pool.sendMessage(agentId, augmentedMessage);
      this.activityLog.record(ActivityType.DELEGATION, `Delegated to agent "${agentId}"`, agentId);
      return result;
    } catch (error) {
      this.activityLog.record(ActivityType.ERROR, `Delegation to "${agentId}" failed`, agentId);
      throw new DelegationError(agentId, error instanceof Error ? error.message : String(error));
    }
  }

  private async executePipeline(steps: DelegationStep[]): Promise<DelegationPipelineResult> {
    const results: DelegationPipelineResult['steps'] = [];
    let accumulatedContext = '';

    for (const step of steps) {
      const taskWithContext = accumulatedContext
        ? `Previous results:\n${accumulatedContext}\n\n---\nTask: ${step.task}${step.context ? `\nContext: ${step.context}` : ''}`
        : `${step.task}${step.context ? `\nContext: ${step.context}` : ''}`;

      try {
        const result = await this.pool.sendMessage(step.agentId, taskWithContext);
        results.push({ agentId: step.agentId, result, success: true });
        accumulatedContext += `\n[${step.agentId}]: ${result}`;
        this.activityLog.record(
          ActivityType.DELEGATION,
          `Pipeline step to "${step.agentId}" succeeded`,
          step.agentId,
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({ agentId: step.agentId, result: '', success: false, error: errorMsg });
        this.activityLog.record(
          ActivityType.ERROR,
          `Pipeline step to "${step.agentId}" failed: ${errorMsg}`,
          step.agentId,
        );
        // Continue on failure — partial results > total failure
      }
    }

    const successResults = results.filter((r) => r.success);
    const finalResult =
      successResults.length > 0
        ? successResults.map((r) => r.result).join('\n\n')
        : 'All pipeline steps failed';

    return {
      steps: results,
      finalResult,
      success: successResults.length > 0,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ConductorNotInitializedError();
    }
  }
}
