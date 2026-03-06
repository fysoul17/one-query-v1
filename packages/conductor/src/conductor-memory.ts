import type {
  ConductorDecision,
  HookRegistryInterface,
  MemoryInterface,
  MemorySearchResult,
} from '@autonomy/shared';
import {
  getErrorDetail,
  HookName,
  Logger,
  MemoryType,
  RAGStrategy,
  StoreTarget,
} from '@autonomy/shared';
import { extractEntities } from './entity-extractor.ts';
import type { IncomingMessage } from './types.ts';

const memoryLogger = new Logger({ context: { source: 'conductor' } });

export interface StoreConversationContext {
  memory: MemoryInterface;
  hookRegistry?: HookRegistryInterface;
  memoryConnected: boolean;
  llmApiKey?: string;
  /** Backend send function for entity extraction (default path, no API key needed). */
  backendSendFn?: (msg: string) => Promise<string>;
}

/**
 * Search memory for context relevant to the incoming message.
 * Returns null on failure (non-fatal).
 */
export async function searchMemoryContext(
  memory: MemoryInterface,
  message: IncomingMessage,
): Promise<MemorySearchResult | null> {
  try {
    return await memory.search({
      query: message.content,
      limit: 5,
      strategy: RAGStrategy.HYBRID,
      ...(message.sessionId ? { agentId: message.senderId } : {}),
    });
  } catch (error) {
    const detail = getErrorDetail(error);
    memoryLogger.warn('Memory search failed', { error: detail });
    return null;
  }
}

interface HookTransform {
  content: string;
  metadata: Record<string, unknown>;
}

/** Run the BEFORE_MEMORY_STORE hook. Returns null when the plugin vetoes storage. */
async function applyMemoryHook(
  hookRegistry: HookRegistryInterface,
  message: IncomingMessage,
  content: string,
  metadata: Record<string, unknown>,
): Promise<HookTransform | null> {
  const hookResult = await hookRegistry.emitWaterfall(HookName.BEFORE_MEMORY_STORE, {
    content,
    metadata,
    agentId: message.senderId,
    sessionId: message.sessionId,
  });
  if (hookResult === null || hookResult === undefined) return null;
  if (typeof hookResult === 'object' && 'content' in hookResult) {
    return {
      content: (hookResult as { content: string }).content,
      metadata: (hookResult as { metadata: Record<string, unknown> }).metadata ?? metadata,
    };
  }
  return { content, metadata };
}

/**
 * Store conversation turn (user message + optional assistant response) in memory.
 * Extracts entities via LLM for knowledge graph population (backend or direct API).
 * Pushes decision entries describing what happened.
 */
export async function storeConversation(
  ctx: StoreConversationContext,
  message: IncomingMessage,
  decisions: ConductorDecision[],
  responseContent?: string,
): Promise<void> {
  if (!ctx.memoryConnected) {
    decisions.push({
      timestamp: new Date().toISOString(),
      action: 'skip_memory',
      reason: 'Memory service not connected',
    });
    return;
  }

  if (message.content.trim().length === 0) {
    decisions.push({
      timestamp: new Date().toISOString(),
      action: 'skip_memory',
      reason: 'Empty message content',
    });
    return;
  }

  let content = message.content;
  let metadata: Record<string, unknown> = { senderName: message.senderName };
  if (ctx.hookRegistry) {
    const transformed = await applyMemoryHook(ctx.hookRegistry, message, content, metadata);
    if (!transformed) {
      decisions.push({
        timestamp: new Date().toISOString(),
        action: 'skip_memory',
        reason: 'Memory store skipped by plugin',
      });
      return;
    }
    content = transformed.content;
    metadata = transformed.metadata;
  }

  try {
    const fullText = responseContent ? `${content}\n\nAssistant: ${responseContent}` : content;
    memoryLogger.info('Extracting entities for memory store', {
      fullTextLength: fullText.length,
      hasApiKey: !!ctx.llmApiKey,
      hasBackendSendFn: !!ctx.backendSendFn,
    });
    const { entities, relationships } = await extractEntities(fullText, {
      apiKey: ctx.llmApiKey,
      backendSendFn: ctx.backendSendFn,
    });
    const hasGraphData = entities.length > 0;
    const graphTargets = hasGraphData
      ? [StoreTarget.SQLITE, StoreTarget.VECTOR, StoreTarget.GRAPH]
      : undefined;

    memoryLogger.info('Storing memory entry', {
      hasGraphData,
      entityCount: entities.length,
      relationshipCount: relationships.length,
      targets: graphTargets ?? ['default'],
    });

    await ctx.memory.store({
      content,
      type: MemoryType.SHORT_TERM,
      agentId: message.senderId,
      sessionId: message.sessionId,
      metadata,
      ...(hasGraphData && { targets: graphTargets, entities, relationships }),
    });

    if (responseContent && responseContent.trim().length > 0) {
      await ctx.memory.store({
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
    memoryLogger.warn('Memory store failed', { error: detail });
  }
}
