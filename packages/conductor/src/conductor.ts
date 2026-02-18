import type { AgentPool, BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import type { MemoryInterface } from '@autonomy/memory';
import type { StreamEvent } from '@autonomy/shared';
import {
  type ActivityEntry,
  ActivityType,
  type AgentDefinition,
  type AgentId,
  AgentOwner,
  type AgentRuntimeInfo,
  type ConductorDecision,
  HookName,
  type HookRegistryInterface,
  Logger,
  type MemorySearchResult,
  MemoryType,
} from '@autonomy/shared';
import { nanoid } from 'nanoid';
import { ActivityLog } from './activity-log.ts';
import {
  ConductorNotInitializedError,
  ConductorShutdownError,
  DelegationDepthError,
  DelegationError,
  QueueFullError,
} from './errors.ts';
import {
  ConductorEventType,
  type ConductorOptions,
  type ConductorResponse,
  type IncomingMessage,
  type OnConductorEvent,
} from './types.ts';

const DEFAULT_MAX_DELEGATION_DEPTH = 5;
const DEFAULT_MAX_QUEUE_DEPTH = 50;

const conductorLogger = new Logger({ context: { source: 'conductor' } });

const DEFAULT_SYSTEM_PROMPT =
  'You are an AI assistant. Answer the user clearly and helpfully. If memory context is provided, use it to inform your response.';

const FALLBACK_NO_BACKEND =
  "I'm the Conductor but have no AI backend configured. Please set up a backend or target a specific agent.";

interface QueuedConductorMessage {
  message: IncomingMessage;
  onEvent?: OnConductorEvent;
  resolve: (result: ConductorResponse) => void;
  reject: (error: Error) => void;
}

function buildAgentDefinition(
  id: string,
  create: {
    name: string;
    role: string;
    systemPrompt: string;
    tools?: string[];
    persistent?: boolean;
  },
): AgentDefinition {
  return {
    id,
    name: create.name,
    role: create.role,
    tools: create.tools ?? [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: AgentOwner.CONDUCTOR,
    persistent: create.persistent ?? false,
    createdBy: 'conductor',
    createdAt: new Date().toISOString(),
    systemPrompt: create.systemPrompt,
  };
}

export class Conductor {
  private pool: AgentPool;
  private memory: MemoryInterface;
  private backend?: CLIBackend;
  private backendProcess?: BackendProcess;
  private activityLog: ActivityLog;
  private initialized = false;
  private options: ConductorOptions;
  private hookRegistry?: HookRegistryInterface;
  private messageQueue: QueuedConductorMessage[] = [];
  private processing = false;

  constructor(
    pool: AgentPool,
    memory: MemoryInterface,
    backend?: CLIBackend,
    options?: ConductorOptions,
  ) {
    this.pool = pool;
    this.memory = memory;
    this.backend = backend;
    this.options = options ?? {};
    this.hookRegistry = options?.hookRegistry;
    this.activityLog = new ActivityLog(options?.maxActivityLogSize);
  }

  get conductorName(): string {
    return 'Conductor';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.backend) {
      try {
        const systemPrompt = this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
        this.backendProcess = await this.backend.spawn({
          agentId: 'conductor',
          systemPrompt,
        });
        this.activityLog.record(ActivityType.MESSAGE, 'Conductor AI process initialized');
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        conductorLogger.warn('Failed to initialize AI backend', { error: detail });
        this.activityLog.record(ActivityType.ERROR, 'AI backend initialization failed');
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

  async *handleMessageStreaming(
    message: IncomingMessage,
    onEvent?: OnConductorEvent,
  ): AsyncGenerator<StreamEvent> {
    this.ensureInitialized();
    this.checkDelegationDepth(message);

    const decisions: ConductorDecision[] = [];

    // Hook: onBeforeMessage
    const processedMessage = await this.runBeforeMessageHook(message);
    if (processedMessage === null) {
      yield { type: 'error', error: 'Message rejected by plugin.' };
      return;
    }

    // Memory search
    const rawMemoryContext = await this.timedStep(
      () => this.searchMemoryContext(processedMessage),
      (durationMs, result) =>
        onEvent?.({
          type: ConductorEventType.MEMORY_SEARCH,
          content: result ? `Found ${result.entries.length} memory entries` : 'No memory results',
          durationMs,
          memoryResults: result?.entries.length ?? 0,
          memoryQuery: processedMessage.content,
          memoryEntryPreviews: result?.entries.slice(0, 5).map((e) => e.content.slice(0, 80)),
        }),
    );
    const memoryContext = await this.runAfterMemorySearchHook(processedMessage, rawMemoryContext);

    let accumulatedContent = '';

    if (processedMessage.targetAgentId) {
      // Delegate to agent — stream from agent pool
      onEvent?.({ type: ConductorEventType.DELEGATING, agentId: processedMessage.targetAgentId });

      const augmentedMessage = this.buildMemoryAugmentedPrompt(
        processedMessage.content,
        memoryContext,
      );

      try {
        for await (const event of this.pool.sendMessageStreaming(
          processedMessage.targetAgentId,
          augmentedMessage,
        )) {
          if (event.type === 'chunk' && event.content) {
            accumulatedContent += event.content;
          }
          yield event;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        yield { type: 'error', error: msg };
        return;
      }
    } else {
      // Conductor responds directly
      if (!this.backendProcess) {
        yield { type: 'chunk', content: FALLBACK_NO_BACKEND };
        yield { type: 'complete' };
        return;
      }

      onEvent?.({
        type: ConductorEventType.RESPONDING,
        content: 'Conductor is responding...',
        dispatchTarget: 'conductor',
      });

      let prompt = this.buildMemoryAugmentedPrompt(processedMessage.content, memoryContext);

      // Hook: onBeforeResponse
      if (this.hookRegistry) {
        const hookResult = await this.hookRegistry.emitWaterfall(HookName.BEFORE_RESPONSE, {
          message: processedMessage,
          memoryContext,
          prompt,
        });
        if (hookResult && typeof hookResult === 'object' && 'prompt' in hookResult) {
          prompt = (hookResult as { prompt: string }).prompt;
        }
      }

      try {
        if (this.backendProcess.sendStreaming) {
          for await (const event of this.backendProcess.sendStreaming(prompt)) {
            if (event.type === 'chunk' && event.content) {
              accumulatedContent += event.content;
            }
            yield event;
          }
        } else {
          const result = await this.backendProcess.send(prompt);
          accumulatedContent = result;
          yield { type: 'chunk', content: result };
          yield { type: 'complete' };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        yield { type: 'error', error: msg };
        return;
      }
    }

    // Hook: onAfterResponse
    await this.runAfterResponseHook(accumulatedContent, processedMessage.targetAgentId, decisions);

    // Store conversation in memory (non-fatal)
    try {
      await this.storeConversation(processedMessage, decisions);
    } catch {
      // Memory store failures are non-fatal
    }
  }

  private async executeMessage(
    message: IncomingMessage,
    onEvent?: OnConductorEvent,
  ): Promise<ConductorResponse> {
    this.processing = true;

    try {
      const decisions: ConductorDecision[] = [];

      // Hook: onBeforeMessage — plugins can transform or reject the message
      const processedMessage = await this.runBeforeMessageHook(message);
      if (processedMessage === null) {
        this.processing = false;
        this.processQueue();
        return {
          content: 'Message rejected by plugin.',
          decisions: [
            {
              timestamp: new Date().toISOString(),
              action: 'plugin_reject',
              reason: 'onBeforeMessage returned null',
            },
          ],
        };
      }

      // 1. Search memory for context (non-fatal)
      const rawMemoryContext = await this.timedStep(
        () => this.searchMemoryContext(processedMessage),
        (durationMs, result) =>
          onEvent?.({
            type: ConductorEventType.MEMORY_SEARCH,
            content: result ? `Found ${result.entries.length} memory entries` : 'No memory results',
            durationMs,
            memoryResults: result?.entries.length ?? 0,
            memoryQuery: processedMessage.content,
            memoryEntryPreviews: result?.entries.slice(0, 5).map((e) => e.content.slice(0, 80)),
          }),
      );

      // Hook: onAfterMemorySearch — plugins can transform memory results
      const memoryContext = await this.runAfterMemorySearchHook(processedMessage, rawMemoryContext);

      // 2. Dispatch — delegate to specific agent or respond directly
      let responseContent: string;
      let responseAgentId: string | undefined;

      if (processedMessage.targetAgentId) {
        // Delegate to targeted agent
        onEvent?.({ type: ConductorEventType.DELEGATING, agentId: processedMessage.targetAgentId });
        responseContent = await this.delegateToAgent(
          processedMessage.targetAgentId,
          processedMessage,
          memoryContext,
        );
        responseAgentId = processedMessage.targetAgentId;
        decisions.push({
          timestamp: new Date().toISOString(),
          action: 'delegate',
          targetAgentId: processedMessage.targetAgentId,
          reason: `Delegated to agent "${processedMessage.targetAgentId}"`,
        });
        onEvent?.({
          type: ConductorEventType.DELEGATION_COMPLETE,
          content: 'Delegation complete',
          durationMs: 0,
          decisions,
        });
      } else {
        // Conductor responds directly via AI backend
        responseContent = await this.generateResponse(
          processedMessage,
          memoryContext,
          decisions,
          onEvent,
        );
      }

      // Hook: onAfterResponse — plugins can transform the response
      responseContent = await this.runAfterResponseHook(
        responseContent,
        responseAgentId,
        decisions,
      );

      // 3. Store conversation in memory (non-fatal)
      await this.timedStep(
        () => this.storeConversation(processedMessage, decisions),
        (durationMs) =>
          onEvent?.({
            type: ConductorEventType.MEMORY_STORE,
            content: 'Conversation stored',
            durationMs,
          }),
      );

      this.activityLog.record(
        ActivityType.MESSAGE,
        `Handled message from "${processedMessage.senderName}"`,
        undefined,
        { senderId: processedMessage.senderId },
      );

      const response: ConductorResponse = {
        content: responseContent,
        agentId: responseAgentId,
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
    const definition = buildAgentDefinition(id, params);
    const process = await this.pool.create(definition);
    this.activityLog.record(ActivityType.AGENT_CREATED, `Created agent "${params.name}"`, id);

    return process.toRuntimeInfo();
  }

  async deleteAgent(agentId: AgentId): Promise<void> {
    this.ensureInitialized();
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

  getActivity(limit?: number): ActivityEntry[] {
    return this.activityLog.getRecent(limit);
  }

  getAgentActivity(agentId: AgentId, limit?: number): ActivityEntry[] {
    return this.activityLog.getByAgent(agentId, limit);
  }

  async shutdown(): Promise<void> {
    this.activityLog.record(ActivityType.MESSAGE, 'Conductor shutting down');

    for (const queued of this.messageQueue) {
      queued.reject(new ConductorShutdownError());
    }
    this.messageQueue = [];
    this.processing = false;

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

  private buildMemoryAugmentedPrompt(
    content: string,
    memoryContext: MemorySearchResult | null,
  ): string {
    if (!memoryContext || memoryContext.entries.length === 0) return content;
    const contextSnippet = memoryContext.entries
      .slice(0, 3)
      .map((e) => e.content)
      .join('\n---\n');
    return `<memory-context>\n${contextSnippet}\n</memory-context>\n\nUser message: ${content}`;
  }

  private async runBeforeMessageHook(message: IncomingMessage): Promise<IncomingMessage | null> {
    if (!this.hookRegistry) return message;
    const hookResult = await this.hookRegistry.emitWaterfall(HookName.BEFORE_MESSAGE, { message });
    if (hookResult === null || hookResult === undefined) return null;
    return (hookResult as { message: IncomingMessage }).message ?? message;
  }

  private async runAfterMemorySearchHook(
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
  ): Promise<MemorySearchResult | null> {
    if (!this.hookRegistry) return memoryContext;
    const hookResult = await this.hookRegistry.emitWaterfall(HookName.AFTER_MEMORY_SEARCH, {
      message,
      memoryResult: memoryContext,
    });
    if (hookResult && typeof hookResult === 'object' && 'memoryResult' in hookResult) {
      return (hookResult as { memoryResult: MemorySearchResult | null }).memoryResult;
    }
    return memoryContext;
  }

  private async runAfterResponseHook(
    responseContent: string,
    responseAgentId: string | undefined,
    decisions: ConductorDecision[],
  ): Promise<string> {
    if (!this.hookRegistry) return responseContent;
    const hookResult = await this.hookRegistry.emitWaterfall(HookName.AFTER_RESPONSE, {
      response: { content: responseContent, agentId: responseAgentId, decisions },
    });
    if (hookResult && typeof hookResult === 'object' && 'response' in hookResult) {
      return (hookResult as { response: ConductorResponse }).response.content;
    }
    return responseContent;
  }

  private async searchMemoryContext(message: IncomingMessage): Promise<MemorySearchResult | null> {
    try {
      return await this.memory.search({
        query: message.content,
        limit: 5,
        ...(message.sessionId ? { agentId: message.senderId } : {}),
      });
    } catch {
      return null;
    }
  }

  private async generateResponse(
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
    decisions: ConductorDecision[],
    onEvent?: OnConductorEvent,
  ): Promise<string> {
    if (!this.backendProcess) {
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'direct_response',
        reason: 'No AI backend available',
      });
      return FALLBACK_NO_BACKEND;
    }

    onEvent?.({
      type: ConductorEventType.RESPONDING,
      content: 'Conductor is responding...',
      dispatchTarget: 'conductor',
    });

    let prompt = this.buildMemoryAugmentedPrompt(message.content, memoryContext);

    // Hook: onBeforeResponse — plugins can transform the prompt
    if (this.hookRegistry) {
      const hookResult = await this.hookRegistry.emitWaterfall(HookName.BEFORE_RESPONSE, {
        message,
        memoryContext,
        prompt,
      });
      if (hookResult && typeof hookResult === 'object' && 'prompt' in hookResult) {
        prompt = (hookResult as { prompt: string }).prompt;
      }
    }

    try {
      const response = await this.backendProcess.send(prompt);
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'direct_response',
        reason: 'Conductor responded directly',
      });
      this.activityLog.record(ActivityType.MESSAGE, 'Conductor responded directly to user');
      return response;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      this.activityLog.record(ActivityType.ERROR, `Response generation failed: ${detail}`);
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'direct_response',
        reason: `Response failed: ${detail}`,
      });
      return 'I encountered an error generating a response. Please try again.';
    }
  }

  private async delegateToAgent(
    agentId: AgentId,
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
  ): Promise<string> {
    const augmentedMessage = this.buildMemoryAugmentedPrompt(message.content, memoryContext);

    try {
      const result = await this.pool.sendMessage(agentId, augmentedMessage);
      this.activityLog.record(ActivityType.DELEGATION, `Delegated to agent "${agentId}"`, agentId);
      return result;
    } catch (error) {
      this.activityLog.record(ActivityType.ERROR, `Delegation to "${agentId}" failed`, agentId);
      throw new DelegationError(agentId, error instanceof Error ? error.message : String(error));
    }
  }

  private async storeConversation(
    message: IncomingMessage,
    decisions: ConductorDecision[],
  ): Promise<void> {
    if (message.content.trim().length === 0) {
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'skip_memory',
        reason: 'Empty message content',
      });
      return;
    }

    // Hook: onBeforeMemoryStore — plugins can transform or skip memory storage
    let content = message.content;
    let metadata: Record<string, unknown> = { senderName: message.senderName };
    if (this.hookRegistry) {
      const hookResult = await this.hookRegistry.emitWaterfall(HookName.BEFORE_MEMORY_STORE, {
        content,
        metadata,
        agentId: message.senderId,
        sessionId: message.sessionId,
      });
      if (hookResult === null || hookResult === undefined) {
        decisions.push({
          timestamp: new Date().toISOString(),
          action: 'skip_memory',
          reason: 'Memory store skipped by plugin',
        });
        return;
      }
      if (typeof hookResult === 'object' && 'content' in hookResult) {
        content = (hookResult as { content: string }).content;
        metadata = (hookResult as { metadata: Record<string, unknown> }).metadata ?? metadata;
      }
    }

    try {
      await this.memory.store({
        content,
        type: MemoryType.SHORT_TERM,
        agentId: message.senderId,
        sessionId: message.sessionId,
        metadata,
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
