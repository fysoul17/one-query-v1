/**
 * MiddlewarePipeline — Koa/Express-style middleware chain.
 *
 * Each middleware receives (context, next) and can:
 * - Modify context before calling next()
 * - Run logic after next() returns
 * - Short-circuit by not calling next()
 * - Catch and recover from errors in next()
 */

import type { Middleware } from './types.ts';

interface MiddlewareEntry<TContext = Record<string, unknown>> {
  handler: Middleware<TContext>;
  priority: number;
}

export class MiddlewarePipeline<TContext = Record<string, unknown>> {
  private entries: MiddlewareEntry<TContext>[] = [];

  use(handler: Middleware<TContext>, options?: { priority?: number }): void {
    this.entries.push({
      handler,
      priority: options?.priority ?? this.entries.length * 100 + 100,
    });
  }

  remove(handler: Middleware<TContext>): void {
    const idx = this.entries.findIndex((e) => e.handler === handler);
    if (idx !== -1) {
      this.entries.splice(idx, 1);
    }
  }

  get size(): number {
    return this.entries.length;
  }

  async execute(ctx: TContext): Promise<void> {
    const sorted = [...this.entries].sort((a, b) => a.priority - b.priority);
    let index = 0;

    const next = async (): Promise<void> => {
      if (index >= sorted.length) return;
      const entry = sorted[index++];
      if (entry) await entry.handler(ctx, next);
    };

    await next();
  }
}
