import type {
  ConductorDecision,
  HookRegistryInterface,
  MemoryInterface,
  MemorySearchResult,
} from '@autonomy/shared';
import { getErrorDetail, HookName, Logger, MemoryType, RAGStrategy, StoreTarget } from '@autonomy/shared';
import { extractEntities } from './entity-extractor.ts';
import type { IncomingMessage } from './types.ts';

const memoryLogger = new Logger({ context: { source: 'conductor' } });

export interface StoreConversationContext {
  memory: MemoryInterface;
  hookRegistry?: HookRegistryInterface;
  memoryConnected: boolean;
  llmApiKey?: string;
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

/**
 * Store conversation turn (user message + optional assistant response) in memory.
 * Extracts entities via LLM for knowledge graph population when an API key is available.
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

  // Hook: onBeforeMemoryStore — plugins can transform or skip memory storage
  let content = message.content;
  let metadata: Record<string, unknown> = { senderName: message.senderName };
  if (ctx.hookRegistry) {
    const hookResult = await ctx.hookRegistry.emitWaterfall(HookName.BEFORE_MEMORY_STORE, {
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
    // Extract entities from conversation for graph population
    const fullText = responseContent
      ? `${content}\n\nAssistant: ${responseContent}`
      : content;
    const { entities, relationships } = await extractEntities(fullText, ctx.llmApiKey ?? '');
    const hasGraphData = entities.length > 0;
    const graphTargets = hasGraphData
      ? [StoreTarget.SQLITE, StoreTarget.VECTOR, StoreTarget.GRAPH]
      : undefined; // use pyx-memory defaults (sqlite + vector)

    // User message store — includes graph data when entities found
    await ctx.memory.store({
      content,
      type: MemoryType.SHORT_TERM,
      agentId: message.senderId,
      sessionId: message.sessionId,
      metadata,
      ...(hasGraphData && { targets: graphTargets, entities, relationships }),
    });

    // Assistant response store — no graph data (already ingested above)
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
