import type { AgentPool, BackendProcess, CLIBackend } from '@autonomy/agent-manager';
import type { StreamEvent } from '@autonomy/shared';
import {
  type ActivityEntry,
  ActivityType,
  type AgentDefinition,
  type AgentId,
  AgentOwner,
  type AgentRuntimeInfo,
  type ConductorDecision,
  getErrorDetail,
  HookName,
  type HookRegistryInterface,
  Logger,
  type MemorySearchResult,
  MemoryType,
  RAGStrategy,
} from '@autonomy/shared';
import type { MemoryInterface } from '@pyx-memory/client';
import { nanoid } from 'nanoid';
import { ActivityLog } from './activity-log.ts';
import {
  ConductorNotInitializedError,
  ConductorShutdownError,
  DelegationDepthError,
  DelegationError,
  QueueFullError,
} from './errors.ts';
import { SessionProcessPool } from './session-process-pool.ts';
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
  private fallbackBackend?: CLIBackend;
  private backendProcess?: BackendProcess;
  private sessionPool!: SessionProcessPool;
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
    this.fallbackBackend = options?.fallbackBackend;
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
        const detail = getErrorDetail(error);
        conductorLogger.warn('Failed to initialize AI backend', { error: detail });
        this.activityLog.record(ActivityType.ERROR, 'AI backend initialization failed');

        if (this.fallbackBackend) {
          try {
            conductorLogger.info('Trying fallback backend', {
              fallback: this.fallbackBackend.name,
            });
            const systemPrompt = this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
            this.backendProcess = await this.fallbackBackend.spawn({
              agentId: 'conductor',
              systemPrompt,
            });
            this.activityLog.record(
              ActivityType.MESSAGE,
              `Conductor AI process initialized via fallback (${this.fallbackBackend.name})`,
            );
          } catch (fallbackError) {
            const fbDetail = getErrorDetail(fallbackError);
            conductorLogger.warn('Fallback backend also failed', { error: fbDetail });
            this.activityLog.record(ActivityType.ERROR, 'Fallback backend initialization failed');
          }
        }
      }
    }

    const systemPrompt = this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.sessionPool = new SessionProcessPool(this.backend, this.fallbackBackend, systemPrompt);

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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming orchestration requires sequential branching
  async *handleMessageStreaming(
    message: IncomingMessage,
    onEvent?: OnConductorEvent,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    this.ensureInitialized();
    this.checkDelegationDepth(message);

    if (signal?.aborted) {
      yield { type: 'error', error: 'Aborted' };
      return;
    }

    const decisions: ConductorDecision[] = [];

    const prepared = await this.prepareMessage(message, onEvent);
    if (!prepared) {
      yield { type: 'error', error: 'Message rejected by plugin.' };
      return;
    }
    const { processedMessage, memoryContext } = prepared;

    let accumulatedContent = '';

    if (processedMessage.targetAgentId) {
      // Delegate to agent — stream from agent pool
      const delegateAgent = this.pool.get(processedMessage.targetAgentId);
      onEvent?.({
        type: ConductorEventType.DELEGATING,
        agentId: processedMessage.targetAgentId,
        agentName: delegateAgent?.definition.name,
      });

      const augmentedMessage = this.buildMemoryAugmentedPrompt(processedMessage, memoryContext);

      try {
        for await (const event of this.pool.sendMessageStreaming(
          processedMessage.targetAgentId,
          augmentedMessage,
          signal,
        )) {
          if (signal?.aborted) {
            yield { type: 'error', error: 'Aborted' };
            return;
          }
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
      // Conductor responds directly — use per-session backend process
      const configOverrides = processedMessage.metadata?.configOverrides as
        | Record<string, string>
        | undefined;
      const sessionBackend = processedMessage.sessionId
        ? await this.sessionPool.getOrCreate(processedMessage.sessionId, configOverrides)
        : this.backendProcess;
      if (!sessionBackend) {
        yield { type: 'chunk', content: FALLBACK_NO_BACKEND };
        yield { type: 'complete' };
        return;
      }

      onEvent?.({
        type: ConductorEventType.RESPONDING,
        content: 'Conductor is responding...',
        dispatchTarget: 'conductor',
      });

      const prompt = await this.preparePrompt(processedMessage, memoryContext);

      try {
        if (sessionBackend.sendStreaming) {
          for await (const event of sessionBackend.sendStreaming(prompt, signal)) {
            if (signal?.aborted) {
              yield { type: 'error', error: 'Aborted' };
              return;
            }
            if (event.type === 'chunk' && event.content) {
              accumulatedContent += event.content;
            }
            yield event;
          }
        } else {
          const result = await sessionBackend.send(prompt);
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

    // Finalize — afterResponse hook, store conversation, record activity
    await this.finalizeResponse(
      processedMessage,
      accumulatedContent,
      processedMessage.targetAgentId,
      decisions,
      onEvent,
    );
  }

  private async executeMessage(
    message: IncomingMessage,
    onEvent?: OnConductorEvent,
  ): Promise<ConductorResponse> {
    this.processing = true;

    try {
      const decisions: ConductorDecision[] = [];

      const prepared = await this.prepareMessage(message, onEvent);
      if (!prepared) {
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
      const { processedMessage, memoryContext } = prepared;

      // 2. Dispatch — delegate to specific agent or respond directly
      let responseContent: string;
      let responseAgentId: string | undefined;

      if (processedMessage.targetAgentId) {
        // Delegate to targeted agent
        const delegateAgentExec = this.pool.get(processedMessage.targetAgentId);
        onEvent?.({
          type: ConductorEventType.DELEGATING,
          agentId: processedMessage.targetAgentId,
          agentName: delegateAgentExec?.definition.name,
        });
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
        const configOverrides = processedMessage.metadata?.configOverrides as
          | Record<string, string>
          | undefined;
        const sessionBackend = processedMessage.sessionId
          ? await this.sessionPool.getOrCreate(processedMessage.sessionId, configOverrides)
          : this.backendProcess;
        if (!sessionBackend) {
          decisions.push({
            timestamp: new Date().toISOString(),
            action: 'direct_response',
            reason: 'No AI backend available',
          });
          responseContent = FALLBACK_NO_BACKEND;
        } else {
          onEvent?.({
            type: ConductorEventType.RESPONDING,
            content: 'Conductor is responding...',
            dispatchTarget: 'conductor',
          });

          const prompt = await this.preparePrompt(processedMessage, memoryContext);

          try {
            responseContent = await sessionBackend.send(prompt);
            decisions.push({
              timestamp: new Date().toISOString(),
              action: 'direct_response',
              reason: 'Conductor responded directly',
            });
            this.activityLog.record(ActivityType.MESSAGE, 'Conductor responded directly to user');
          } catch (error) {
            const detail = getErrorDetail(error);
            this.activityLog.record(ActivityType.ERROR, `Response generation failed: ${detail}`);
            decisions.push({
              timestamp: new Date().toISOString(),
              action: 'direct_response',
              reason: `Response failed: ${detail}`,
            });
            responseContent = 'I encountered an error generating a response. Please try again.';
          }
        }
      }

      // Finalize — afterResponse hook, store conversation, record activity
      responseContent = await this.finalizeResponse(
        processedMessage,
        responseContent,
        responseAgentId,
        decisions,
        onEvent,
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

    try {
      const process = await this.pool.create(definition);
      this.activityLog.record(ActivityType.AGENT_CREATED, `Created agent "${params.name}"`, id);
      conductorLogger.info('Agent created', { agentId: id, name: params.name });
      return process.toRuntimeInfo();
    } catch (error) {
      const detail = getErrorDetail(error);
      this.activityLog.record(
        ActivityType.ERROR,
        `Failed to create agent "${params.name}": ${detail}`,
      );
      conductorLogger.error('Agent creation failed', { name: params.name, error: detail });
      throw error;
    }
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

  /** Kill the backend process for a session so it respawns with new config on next message. */
  invalidateSessionBackend(sessionId: string): void {
    this.sessionPool.invalidate(sessionId);
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
      } catch (error) {
        const detail = getErrorDetail(error);
        conductorLogger.debug('Error stopping backend during shutdown', { error: detail });
      }
      this.backendProcess = undefined;
    }

    // Stop all per-session backend processes
    await this.sessionPool.shutdown();

    this.initialized = false;
  }

  private buildMemoryAugmentedPrompt(
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
  ): string {
    let prompt = message.content;

    // Conversation history is no longer injected here — native session resume
    // in each CLI backend (Claude --resume, Codex exec resume, Gemini --resume,
    // Pi RPC mode) handles multi-turn context natively.

    // Layer on RAG memory (long-term knowledge across sessions).
    if (memoryContext && memoryContext.entries.length > 0) {
      const contextSnippet = memoryContext.entries
        .slice(0, 3)
        .map((e) => e.content)
        .join('\n---\n');
      prompt = `<memory-context>\n${contextSnippet}\n</memory-context>\n\n${prompt}`;
    }

    return prompt;
  }

  /**
   * Build the final prompt for a direct conductor response: augment with memory
   * context, then run the onBeforeResponse hook so plugins can transform it.
   */
  private async preparePrompt(
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
  ): Promise<string> {
    let prompt = this.buildMemoryAugmentedPrompt(message, memoryContext);

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

    return prompt;
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

  /**
   * Common pipeline prefix: runs beforeMessage hook, memory search, and
   * afterMemorySearch hook. Returns null when the message is rejected by a plugin.
   */
  private async prepareMessage(
    message: IncomingMessage,
    onEvent?: OnConductorEvent,
  ): Promise<{
    processedMessage: IncomingMessage;
    memoryContext: MemorySearchResult | null;
  } | null> {
    const processedMessage = await this.runBeforeMessageHook(message);
    if (processedMessage === null) return null;

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

    return { processedMessage, memoryContext };
  }

  /**
   * Common pipeline suffix: runs afterResponse hook (using the transformed
   * content for storage), stores the conversation in memory, and records
   * the activity log entry.
   */
  private async finalizeResponse(
    processedMessage: IncomingMessage,
    responseContent: string,
    responseAgentId: string | undefined,
    decisions: ConductorDecision[],
    onEvent?: OnConductorEvent,
  ): Promise<string> {
    const finalContent = await this.runAfterResponseHook(
      responseContent,
      responseAgentId,
      decisions,
    );

    try {
      await this.timedStep(
        () => this.storeConversation(processedMessage, decisions, finalContent),
        (durationMs) =>
          onEvent?.({
            type: ConductorEventType.MEMORY_STORE,
            content: 'Conversation stored',
            durationMs,
          }),
      );
    } catch (error) {
      const detail = getErrorDetail(error);
      conductorLogger.warn('Memory store failed', { error: detail });
    }

    this.activityLog.record(
      ActivityType.MESSAGE,
      `Handled message from "${processedMessage.senderName}"`,
      undefined,
      { senderId: processedMessage.senderId },
    );

    return finalContent;
  }

  private async searchMemoryContext(message: IncomingMessage): Promise<MemorySearchResult | null> {
    try {
      return await this.memory.search({
        query: message.content,
        limit: 5,
        strategy: RAGStrategy.HYBRID,
        ...(message.sessionId ? { agentId: message.senderId } : {}),
      });
    } catch (error) {
      const detail = getErrorDetail(error);
      conductorLogger.warn('Memory search failed', { error: detail });
      return null;
    }
  }

  private async delegateToAgent(
    agentId: AgentId,
    message: IncomingMessage,
    memoryContext: MemorySearchResult | null,
  ): Promise<string> {
    const augmentedMessage = this.buildMemoryAugmentedPrompt(message, memoryContext);

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
    responseContent?: string,
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

      // Also store assistant response so memory search can find it
      if (responseContent && responseContent.trim().length > 0) {
        await this.memory.store({
          content: responseContent,
          type: MemoryType.EPISODIC,
          agentId: 'conductor',
          sessionId: message.sessionId,
          metadata: { role: 'assistant' },
        });
      }

      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'store_memory',
        reason: 'Stored conversation in memory',
      });
    } catch (error) {
      const detail = getErrorDetail(error);
      conductorLogger.warn('Memory store failed', { error: detail });
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
