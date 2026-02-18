/**
 * HookRegistry — Central registry for plugin hooks.
 *
 * Supports two emission patterns:
 * - emit(): Fire-and-forget (notifications). Errors are caught and swallowed.
 * - emitWaterfall(): Data transformation. Each handler can transform the data.
 *   Errors cause the handler to be skipped (data passes through unchanged).
 */

import type { HookHandler, HookRegistration, HookRegistryInterface } from './types.ts';

export class HookRegistry implements HookRegistryInterface {
  private handlers: HookRegistration[] = [];

  register<T = unknown>(
    hookType: string,
    handler: HookHandler<T>,
    options?: { priority?: number; pluginId?: string },
  ): () => void {
    const registration: HookRegistration = {
      hookType,
      handler: handler as HookHandler,
      priority: options?.priority ?? 100,
      pluginId: options?.pluginId,
    };

    this.handlers.push(registration);

    // Return unsubscribe function
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = this.handlers.indexOf(registration);
      if (idx !== -1) {
        this.handlers.splice(idx, 1);
      }
    };
  }

  async emit<T = unknown>(hookType: string, data: T): Promise<void> {
    const sorted = this.getHandlersForType(hookType);
    for (const reg of sorted) {
      try {
        await reg.handler(data);
      } catch {
        // Fire-and-forget: swallow handler errors
      }
    }
  }

  async emitWaterfall<T = unknown>(hookType: string, data: T): Promise<T> {
    const sorted = this.getHandlersForType(hookType);
    let current = data;

    for (const reg of sorted) {
      try {
        const result = await reg.handler(current);
        if (result !== undefined) {
          current = result as T;
        }
      } catch {
        // Waterfall: skip erroring handler, pass data through unchanged
      }
    }

    return current;
  }

  unregisterPlugin(pluginId: string): void {
    this.handlers = this.handlers.filter((h) => h.pluginId !== pluginId);
  }

  getHandlerCount(hookType?: string): number {
    if (hookType === undefined) {
      return this.handlers.length;
    }
    return this.handlers.filter((h) => h.hookType === hookType).length;
  }

  clear(): void {
    this.handlers = [];
  }

  private getHandlersForType(hookType: string): HookRegistration[] {
    return this.handlers
      .filter((h) => h.hookType === hookType)
      .sort((a, b) => a.priority - b.priority);
  }
}
