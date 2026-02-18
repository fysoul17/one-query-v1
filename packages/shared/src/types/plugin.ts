/**
 * Shared plugin system type constants.
 *
 * These are re-exported from @autonomy/shared so that both
 * @autonomy/plugin-system and consuming packages can reference
 * hook names without depending on the full plugin-system package.
 */

/** Generic hook handler function type. */
export type HookHandler<T = unknown> = (data: T) => T | undefined | Promise<T | undefined>;

/** Minimal interface for the hook registry, shared across packages. */
export interface HookRegistryInterface {
  register<T = unknown>(
    hookType: string,
    handler: HookHandler<T>,
    options?: { priority?: number; pluginId?: string },
  ): () => void;
  emit<T = unknown>(hookType: string, data: T): Promise<void>;
  emitWaterfall<T = unknown>(hookType: string, data: T): Promise<T>;
  unregisterPlugin(pluginId: string): void;
  getHandlerCount(hookType?: string): number;
  clear(): void;
}

export const HookName = {
  BEFORE_MESSAGE: 'onBeforeMessage',
  AFTER_MEMORY_SEARCH: 'onAfterMemorySearch',
  BEFORE_RESPONSE: 'onBeforeResponse',
  AFTER_RESPONSE: 'onAfterResponse',
  BEFORE_AGENT_CREATE: 'onBeforeAgentCreate',
  AFTER_AGENT_CREATE: 'onAfterAgentCreate',
  BEFORE_AGENT_DELETE: 'onBeforeAgentDelete',
  BEFORE_MEMORY_STORE: 'onBeforeMemoryStore',
} as const;
export type HookName = (typeof HookName)[keyof typeof HookName];
