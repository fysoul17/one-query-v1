import type { AgentPool, BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import { MaxAgentsReachedError } from '@autonomy/agent-manager';
import type { Memory } from '@autonomy/memory';
import {
  type ActivityEntry,
  ActivityType,
  type AgentDefinition,
  type AgentId,
  AgentOwner,
  type AgentRuntimeInfo,
  AgentStatus,
  ConductorAction,
  type ConductorDecision,
  type MemorySearchResult,
  MemoryType,
} from '@autonomy/shared';
import { nanoid } from 'nanoid';
import { ActivityLog } from './activity-log.ts';
import { buildResponsePrompt, CONDUCTOR_SYSTEM_PROMPT } from './conductor-prompt.ts';
import {
  ConductorNotInitializedError,
  ConductorShutdownError,
  DelegationDepthError,
  DelegationError,
  QueueFullError,
} from './errors.ts';
import { PermissionChecker } from './permissions.ts';
import { createAIRouter, defaultRouter, RouterManager } from './router.ts';
import {
  ConductorEventType,
  type ConductorOptions,
  type ConductorResponse,
  type DelegationPipelineResult,
  type DelegationStep,
  type IncomingMessage,
  type OnConductorEvent,
  type RouterFn,
  type RoutingResult,
} from './types.ts';

const DEFAULT_MAX_DELEGATION_DEPTH = 5;
const DEFAULT_MAX_QUEUE_DEPTH = 50;

interface QueuedConductorMessage {
  message: IncomingMessage;
  onEvent?: OnConductorEvent;
  resolve: (result: ConductorResponse) => void;
  reject: (error: Error) => void;
}

const FALLBACK_NO_AGENTS =
  "I'm the Conductor. No specialist agents are available yet. You can create agents from the Agents page, or ask me to create one for a specific task.";

const FALLBACK_RESPONSE_ERROR =
  "I'm the Conductor. I tried to respond but encountered an error. You can try again or create a specialist agent for your task.";

function buildAgentDefinition(
  id: string,
  create: { name: string; role: string; systemPrompt: string },
): AgentDefinition {
  return {
    id,
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
}

export class Conductor {
  private pool: AgentPool;
  private memory: Memory;
  private backend?: CLIBackend;
  private backendProcess?: BackendProcess;
  private routerManager = new RouterManager();
  private permissions = new PermissionChecker();
  private activityLog: ActivityLog;
  private initialized = false;
  private options: ConductorOptions;
  private messageQueue: QueuedConductorMessage[] = [];
  private processing = false;

  constructor(pool: AgentPool, memory: Memory, backend?: CLIBackend, options?: ConductorOptions) {
    this.pool = pool;
    this.memory = memory;
    this.backend = backend;
    this.options = options ?? {};
    this.activityLog = new ActivityLog(options?.maxActivityLogSize);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // If an AI backend is provided, spawn the conductor's own AI process
    if (this.backend) {
      try {
        const systemPrompt = this.options.systemPrompt ?? CONDUCTOR_SYSTEM_PROMPT;
        this.backendProcess = await this.backend.spawn({
          agentId: 'conductor',
          systemPrompt,
        });
        const aiRouter = createAIRouter(this.backendProcess);
        this.routerManager.setRouter(aiRouter);
        this.activityLog.record(ActivityType.MESSAGE, 'Conductor AI router initialized');
      } catch (error) {
        // AI initialization failure is non-fatal — fall back to keyword router
        const detail = error instanceof Error ? error.message : 'Unknown error';
        console.warn(
          `[conductor] Failed to initialize AI router, using keyword fallback: ${detail}`,
        );
        this.activityLog.record(
          ActivityType.ERROR,
          'AI router initialization failed, using keyword fallback',
        );
      }
    }

    this.initialized = true;
    this.activityLog.record(ActivityType.MESSAGE, 'Conductor initialized');
  }

  get queueDepth(): number {
    return this.messageQueue.length;
  }

  async handleMessage(
    message: IncomingMessage,
    onEvent?: OnConductorEvent,
  ): Promise<ConductorResponse> {
    this.ensureInitialized();
    this.checkDelegationDepth(message);

    // If already processing a message, queue this one
    if (this.processing) {
      const maxDepth = this.options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
      if (this.messageQueue.length >= maxDepth) {
        throw new QueueFullError(maxDepth);
      }
      onEvent?.({
        type: ConductorEventType.QUEUED,
        content: 'Message queued',
      });
      return new Promise<ConductorResponse>((resolve, reject) => {
        this.messageQueue.push({ message, onEvent, resolve, reject });
      });
    }

    return this.executeMessage(message, onEvent);
  }

  private async executeMessage(
    message: IncomingMessage,
    onEvent?: OnConductorEvent,
  ): Promise<ConductorResponse> {
    this.processing = true;

    try {
      const decisions: ConductorDecision[] = [];

      // 1. Search memory for context (non-fatal)
      const memoryContext = await this.timedStep(
        () => this.searchMemoryContext(message),
        (durationMs, result) =>
          onEvent?.({
            type: ConductorEventType.MEMORY_SEARCH,
            content: result ? `Found ${result.entries.length} memory entries` : 'No memory results',
            durationMs,
            memoryResults: result?.entries.length ?? 0,
            memoryQuery: message.content,
            memoryEntryPreviews: result?.entries.slice(0, 5).map((e) => e.content.slice(0, 80)),
          }),
      );

      // 2. Route via RouterManager
      onEvent?.({ type: ConductorEventType.ROUTING, content: 'Analyzing request...' });
      const agents = this.pool.list();
      const routingResult = await this.timedStep(
        () => this.routerManager.route(message, agents, memoryContext),
        (durationMs, result) => {
          const routerType = this.backendProcess ? 'ai' : 'keyword';
          decisions.push({
            timestamp: new Date().toISOString(),
            action: routerType === 'ai' ? 'ai_route' : 'route',
            reason: result.reason,
          });
          onEvent?.({ type: ConductorEventType.ROUTING, content: result.reason });
          onEvent?.({
            type: ConductorEventType.ROUTING_COMPLETE,
            content: result.reason,
            durationMs,
            routerType,
          });
        },
      );

      // 3. Dispatch to appropriate handler
      const responseContent = await this.timedStep(
        () => this.dispatch(routingResult, message, memoryContext, decisions, onEvent),
        (durationMs) =>
          onEvent?.({
            type: ConductorEventType.DELEGATION_COMPLETE,
            content: 'Delegation complete',
            durationMs,
            decisions,
          }),
      );

      // 4. Store conversation in memory (non-fatal)
      await this.timedStep(
        () => this.storeConversation(message, routingResult, decisions),
        (durationMs) =>
          onEvent?.({
            type: ConductorEventType.MEMORY_STORE,
            content: 'Conversation stored',
            durationMs,
          }),
      );

      this.activityLog.record(
        ActivityType.MESSAGE,
        `Handled message from "${message.senderName}"`,
        undefined,
        { senderId: message.senderId, agentCount: routingResult.agentIds.length },
      );

      const response: ConductorResponse = {
        content: responseContent,
        agentId: routingResult.agentIds[0],
        decisions,
      };

      this.processing = false;
      this.processQueue();
      return response;
    } catch (error) {
      this.processing = false;
      this.processQueue();
      throw error;
    }
  }

  private processQueue(): void {
    if (this.messageQueue.length === 0) return;
    const next = this.messageQueue.shift();
    if (!next) return;
    this.executeMessage(next.message, next.onEvent).then(next.resolve, next.reject);
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

    // Reject all queued messages
    for (const queued of this.messageQueue) {
      queued.reject(new ConductorShutdownError());
    }
    this.messageQueue = [];
    this.processing = false;

    // Stop the conductor's own AI process
    if (this.backendProcess) {
      try {
        await this.backendProcess.stop();
      } catch {
        // Ignore stop errors during shutdown
      }
      this.backendProcess = undefined;
    }

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
    onEvent?: OnConductorEvent,
  ): Promise<string> {
    if (routingResult.createAgent) {
      return this.dispatchCreateAgent(routingResult, message, memoryContext, decisions, onEvent);
    }

    if (routingResult.agentIds.length === 1) {
      const agentId = routingResult.agentIds[0] as string;
      onEvent?.({ type: ConductorEventType.DELEGATING, agentId });
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

    // Direct response: use pre-generated response from combined call if available
    if (routingResult.directResponse && routingResult.response) {
      onEvent?.({
        type: ConductorEventType.RESPONDING,
        content: 'Conductor responded directly (combined routing+response)',
        dispatchTarget: 'conductor (direct, combined)',
      });
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'direct_response',
        reason: 'Conductor responded directly (combined routing+response — single AI call)',
      });
      this.activityLog.record(ActivityType.MESSAGE, 'Conductor responded directly (combined)');
      return routingResult.response;
    }

    // Direct response: conductor responds via its own AI process (fallback second call)
    if (routingResult.directResponse && this.backendProcess) {
      return this.generateDirectResponse(message, memoryContext, decisions, onEvent);
    }

    // Defense-in-depth: if we have a backend process but routing didn't set directResponse,
    // still try to respond directly rather than returning a dead-end error
    if (this.backendProcess) {
      return this.generateDirectResponse(message, memoryContext, decisions, onEvent);
    }

    return FALLBACK_NO_AGENTS;
  }

  private async dispatchCreateAgent(
    routingResult: RoutingResult,
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
    decisions: ConductorDecision[],
    onEvent?: OnConductorEvent,
  ): Promise<string> {
    const create = routingResult.createAgent as NonNullable<RoutingResult['createAgent']>;
    const newAgentId = nanoid();
    const definition = buildAgentDefinition(newAgentId, create);

    onEvent?.({ type: ConductorEventType.CREATING_AGENT, agentName: create.name });

    try {
      await this.pool.create(definition);
    } catch (error) {
      if (!(error instanceof MaxAgentsReachedError)) throw error;
      const fallback = await this.handleMaxAgentsError(message, memoryContext, decisions, onEvent);
      if (fallback !== null) return fallback;
      // Eviction succeeded — retry creation
      await this.pool.create(definition);
    }

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

    onEvent?.({
      type: ConductorEventType.AGENT_CREATED,
      agentId: newAgentId,
      agentName: create.name,
    });
    onEvent?.({ type: ConductorEventType.DELEGATING, agentId: newAgentId });

    const result = await this.delegateToAgent(newAgentId, message, memoryContext);
    decisions.push({
      timestamp: new Date().toISOString(),
      action: 'delegate',
      targetAgentId: newAgentId,
      reason: `Delegated to newly created agent "${definition.name}"`,
    });
    return result;
  }

  private async generateDirectResponse(
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
    decisions: ConductorDecision[],
    onEvent?: OnConductorEvent,
  ): Promise<string> {
    onEvent?.({
      type: ConductorEventType.RESPONDING,
      content: 'Conductor is responding directly...',
      dispatchTarget: 'conductor (direct)',
    });

    const responsePrompt = buildResponsePrompt(message, memoryContext);

    const process = this.backendProcess;
    if (!process) {
      return FALLBACK_NO_AGENTS;
    }

    try {
      const response = await process.send(responsePrompt);
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'direct_response',
        reason: 'Conductor responded directly',
      });
      this.activityLog.record(ActivityType.MESSAGE, 'Conductor responded directly to user');
      return response;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.activityLog.record(ActivityType.ERROR, `Direct response failed: ${detail}`);
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'direct_response',
        reason: `Direct response failed: ${detail}`,
      });
      return FALLBACK_RESPONSE_ERROR;
    }
  }

  /** Try to evict one conductor-owned, non-persistent, idle agent. Returns true if evicted. */
  private async evictIdleAgent(): Promise<boolean> {
    const agents = this.pool.list();
    const evictCandidate = agents.find(
      (a) => a.owner === AgentOwner.CONDUCTOR && !a.persistent && a.status === AgentStatus.IDLE,
    );
    if (!evictCandidate) return false;

    await this.pool.remove(evictCandidate.id);
    this.activityLog.record(
      ActivityType.AGENT_DELETED,
      `Evicted idle agent "${evictCandidate.name}" to make room`,
      evictCandidate.id,
    );
    return true;
  }

  /** Handle MaxAgentsReachedError: try eviction, fall back to existing agent. Returns response string or null if eviction succeeded. */
  private async handleMaxAgentsError(
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
    decisions: ConductorDecision[],
    onEvent?: OnConductorEvent,
  ): Promise<string | null> {
    const evicted = await this.evictIdleAgent();
    if (evicted) return null;

    // Cannot evict — fall back to best existing agent
    decisions.push({
      timestamp: new Date().toISOString(),
      action: 'ai_fallback',
      reason: 'MaxAgents reached, cannot evict idle agent — routing to existing agent',
    });
    const agents = this.pool.list();
    const fallbackResult = await defaultRouter(message, agents, memoryContext);
    if (fallbackResult.agentIds.length > 0) {
      const fallbackId = fallbackResult.agentIds[0] as string;
      onEvent?.({ type: ConductorEventType.DELEGATING, agentId: fallbackId });
      const result = await this.delegateToAgent(fallbackId, message, memoryContext);
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'delegate',
        targetAgentId: fallbackId,
        reason: `Fallback delegation to "${fallbackId}" after MaxAgents`,
      });
      return result;
    }
    return 'Unable to create or route to any agent — pool is full.';
  }

  private async storeConversation(
    message: IncomingMessage,
    routingResult: RoutingResult,
    decisions: ConductorDecision[],
  ): Promise<void> {
    // AI-driven: router decides what's worth remembering
    if (routingResult.storeInMemory === false) {
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'skip_memory',
        reason: 'Router determined message is not worth storing',
      });
      return;
    }

    // Safety net: empty content is never stored
    if (message.content.trim().length === 0) {
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'skip_memory',
        reason: 'Empty message content',
      });
      return;
    }

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
    // Augment message with memory context (wrapped in delimiters for isolation)
    let augmentedMessage = message.content;
    if (memoryContext && memoryContext.entries.length > 0) {
      const contextSnippet = memoryContext.entries
        .slice(0, 3)
        .map((e) => e.content)
        .join('\n---\n');
      augmentedMessage = `<memory-context>\n${contextSnippet}\n</memory-context>\n\nUser message: ${message.content}`;
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

  private checkDelegationDepth(message: IncomingMessage): void {
    const depth = (message.metadata?.delegationDepth as number) ?? 0;
    const maxDepth = this.options.maxDelegationDepth ?? DEFAULT_MAX_DELEGATION_DEPTH;
    if (depth > maxDepth) {
      throw new DelegationDepthError(depth, maxDepth);
    }
  }

  private async timedStep<T>(
    fn: () => Promise<T>,
    onComplete: (durationMs: number, result: T) => void,
  ): Promise<T> {
    const start = performance.now();
    const result = await fn();
    onComplete(Math.round(performance.now() - start), result);
    return result;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ConductorNotInitializedError();
    }
  }
}
