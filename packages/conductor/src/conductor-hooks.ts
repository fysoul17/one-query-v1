import type {
  ConductorDecision,
  HookRegistryInterface,
  MemorySearchResult,
} from '@autonomy/shared';
import { HookName } from '@autonomy/shared';
import type { ConductorResponse, IncomingMessage } from './types.ts';

/**
 * Run the BEFORE_MESSAGE hook. Returns null when a plugin rejects the message.
 */
export async function runBeforeMessageHook(
  hookRegistry: HookRegistryInterface | undefined,
  message: IncomingMessage,
): Promise<IncomingMessage | null> {
  if (!hookRegistry) return message;
  const hookResult = await hookRegistry.emitWaterfall(HookName.BEFORE_MESSAGE, { message });
  if (hookResult === null || hookResult === undefined) return null;
  return (hookResult as { message: IncomingMessage }).message ?? message;
}

/**
 * Run the AFTER_MEMORY_SEARCH hook. Returns the (possibly modified) memory context.
 */
export async function runAfterMemorySearchHook(
  hookRegistry: HookRegistryInterface | undefined,
  message: IncomingMessage,
  memoryContext: MemorySearchResult | null,
): Promise<MemorySearchResult | null> {
  if (!hookRegistry) return memoryContext;
  const hookResult = await hookRegistry.emitWaterfall(HookName.AFTER_MEMORY_SEARCH, {
    message,
    memoryResult: memoryContext,
  });
  if (hookResult && typeof hookResult === 'object' && 'memoryResult' in hookResult) {
    return (hookResult as { memoryResult: MemorySearchResult | null }).memoryResult;
  }
  return memoryContext;
}

/**
 * Run the AFTER_RESPONSE hook. Returns the (possibly modified) response content.
 */
export async function runAfterResponseHook(
  hookRegistry: HookRegistryInterface | undefined,
  responseContent: string,
  responseAgentId: string | undefined,
  decisions: ConductorDecision[],
): Promise<string> {
  if (!hookRegistry) return responseContent;
  const hookResult = await hookRegistry.emitWaterfall(HookName.AFTER_RESPONSE, {
    response: { content: responseContent, agentId: responseAgentId, decisions },
  });
  if (hookResult && typeof hookResult === 'object' && 'response' in hookResult) {
    return (hookResult as { response: ConductorResponse }).response.content;
  }
  return responseContent;
}
