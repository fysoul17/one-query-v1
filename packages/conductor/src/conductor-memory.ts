import type {
  ConductorDecision,
  HookRegistryInterface,
  MemorySearchResult,
} from '@autonomy/shared';
import { getErrorDetail, HookName, Logger, MemoryType, RAGStrategy } from '@autonomy/shared';
import type { MemoryInterface } from '@pyx-memory/client';
import type { IncomingMessage } from './types.ts';

const memoryLogger = new Logger({ context: { source: 'conductor' } });

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
 * Pushes decision entries describing what happened.
 */
export async function storeConversation(
  memory: MemoryInterface,
  hookRegistry: HookRegistryInterface | undefined,
  memoryConnected: boolean,
  message: IncomingMessage,
  decisions: ConductorDecision[],
  responseContent?: string,
): Promise<void> {
  if (!memoryConnected) {
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
  if (hookRegistry) {
    const hookResult = await hookRegistry.emitWaterfall(HookName.BEFORE_MEMORY_STORE, {
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
    await memory.store({
      content,
      type: MemoryType.SHORT_TERM,
      agentId: message.senderId,
      sessionId: message.sessionId,
      metadata,
    });

    // Also store assistant response so memory search can find it
    if (responseContent && responseContent.trim().length > 0) {
      await memory.store({
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
