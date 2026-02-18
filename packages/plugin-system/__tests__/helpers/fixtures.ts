/**
 * Test fixtures for @autonomy/plugin-system tests.
 *
 * Follows the makeX(overrides) pattern used throughout the project.
 */
import type { HookHandler, Middleware, PluginDefinition } from '../../src/types.ts';

let counter = 0;

export function makePlugin(overrides?: Partial<PluginDefinition>): PluginDefinition {
  counter++;
  return {
    name: `test-plugin-${counter}`,
    version: '1.0.0',
    ...overrides,
  };
}

export function makeHookHandler<T = unknown>(
  fn?: (data: T) => T | undefined | Promise<T | undefined>,
): HookHandler<T> {
  const calls: T[] = [];
  const handler = (async (data: T) => {
    calls.push(data);
    if (fn) return fn(data);
    return undefined;
  }) as HookHandler<T> & { calls: T[] };
  handler.calls = calls;
  return handler;
}

export function makeMiddleware<TContext = Record<string, unknown>>(
  fn?: (ctx: TContext, next: () => Promise<void>) => Promise<void>,
): Middleware<TContext> & { calls: TContext[] } {
  const calls: TContext[] = [];
  const middleware = (async (ctx: TContext, next: () => Promise<void>) => {
    calls.push(ctx);
    if (fn) {
      return fn(ctx, next);
    }
    return next();
  }) as Middleware<TContext> & { calls: TContext[] };
  middleware.calls = calls;
  return middleware;
}

export function makeSyncHookHandler<T = unknown>(
  fn?: (data: T) => T | undefined,
): HookHandler<T> & { calls: T[] } {
  const calls: T[] = [];
  const handler = ((data: T) => {
    calls.push(data);
    if (fn) return fn(data);
    return undefined;
  }) as HookHandler<T> & { calls: T[] };
  handler.calls = calls;
  return handler;
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
