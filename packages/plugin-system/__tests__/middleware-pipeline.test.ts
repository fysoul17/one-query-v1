import { beforeEach, describe, expect, test } from 'bun:test';
import { MiddlewarePipeline } from '../src/middleware-pipeline.ts';
import { delay, makeMiddleware } from './helpers/fixtures.ts';

describe('MiddlewarePipeline', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  describe('chain execution', () => {
    test('executes middleware in registration order', async () => {
      const order: number[] = [];
      pipeline.use(async (_ctx, next) => {
        order.push(1);
        await next();
      });
      pipeline.use(async (_ctx, next) => {
        order.push(2);
        await next();
      });
      pipeline.use(async (_ctx, next) => {
        order.push(3);
        await next();
      });

      await pipeline.execute({});
      expect(order).toEqual([1, 2, 3]);
    });

    test('each middleware receives context and next()', async () => {
      let receivedCtx: unknown = null;
      let receivedNext: unknown = null;

      pipeline.use(async (ctx, next) => {
        receivedCtx = ctx;
        receivedNext = next;
        await next();
      });

      const ctx = { message: 'hello' };
      await pipeline.execute(ctx);

      expect(receivedCtx).toBe(ctx);
      expect(typeof receivedNext).toBe('function');
    });

    test('calling next() passes to the next middleware', async () => {
      let secondCalled = false;

      pipeline.use(async (_ctx, next) => {
        await next();
      });
      pipeline.use(async (_ctx, next) => {
        secondCalled = true;
        await next();
      });

      await pipeline.execute({});
      expect(secondCalled).toBe(true);
    });

    test('middleware can modify context before calling next()', async () => {
      pipeline.use(async (ctx: Record<string, unknown>, next) => {
        ctx.modified = true;
        await next();
      });

      let sawModified = false;
      pipeline.use(async (ctx: Record<string, unknown>, next) => {
        sawModified = ctx.modified === true;
        await next();
      });

      await pipeline.execute({});
      expect(sawModified).toBe(true);
    });

    test('middleware can run logic after next() returns', async () => {
      const order: string[] = [];

      pipeline.use(async (_ctx, next) => {
        order.push('before-1');
        await next();
        order.push('after-1');
      });
      pipeline.use(async (_ctx, next) => {
        order.push('before-2');
        await next();
        order.push('after-2');
      });

      await pipeline.execute({});
      expect(order).toEqual(['before-1', 'before-2', 'after-2', 'after-1']);
    });
  });

  describe('priority ordering', () => {
    test('executes middleware by priority (lower = first)', async () => {
      const order: number[] = [];
      pipeline.use(
        async (_ctx, next) => {
          order.push(3);
          await next();
        },
        { priority: 300 },
      );
      pipeline.use(
        async (_ctx, next) => {
          order.push(1);
          await next();
        },
        { priority: 100 },
      );
      pipeline.use(
        async (_ctx, next) => {
          order.push(2);
          await next();
        },
        { priority: 200 },
      );

      await pipeline.execute({});
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('short-circuit', () => {
    test('not calling next() stops the chain', async () => {
      let thirdCalled = false;

      pipeline.use(async (_ctx, next) => {
        await next();
      });
      pipeline.use(async (_ctx, _next) => {
        // Don't call next — short-circuit
      });
      pipeline.use(async (_ctx, next) => {
        thirdCalled = true;
        await next();
      });

      await pipeline.execute({});
      expect(thirdCalled).toBe(false);
    });

    test('short-circuited pipeline still completes without error', async () => {
      pipeline.use(async (ctx: Record<string, unknown>, _next) => {
        ctx.shortCircuited = true;
        // Intentionally not calling next
      });

      const ctx: Record<string, unknown> = {};
      await pipeline.execute(ctx);
      expect(ctx.shortCircuited).toBe(true);
    });
  });

  describe('context passing', () => {
    test('context object is shared across all middlewares', async () => {
      pipeline.use(async (ctx: Record<string, unknown>, next) => {
        ctx.a = 1;
        await next();
      });
      pipeline.use(async (ctx: Record<string, unknown>, next) => {
        ctx.b = 2;
        await next();
      });

      const ctx: Record<string, unknown> = {};
      await pipeline.execute(ctx);
      expect(ctx.a).toBe(1);
      expect(ctx.b).toBe(2);
    });

    test('downstream middleware sees upstream modifications', async () => {
      pipeline.use(async (ctx: Record<string, unknown>, next) => {
        ctx.value = 10;
        await next();
      });

      let downstream = 0;
      pipeline.use(async (ctx: Record<string, unknown>, next) => {
        downstream = ctx.value as number;
        await next();
      });

      await pipeline.execute({});
      expect(downstream).toBe(10);
    });

    test('original message data is accessible in context', async () => {
      let foundContent = '';
      pipeline.use(async (ctx: Record<string, unknown>, next) => {
        foundContent = ctx.content as string;
        await next();
      });

      await pipeline.execute({ content: 'Hello world' });
      expect(foundContent).toBe('Hello world');
    });
  });

  describe('error handling', () => {
    test('middleware throwing error rejects the pipeline promise', async () => {
      pipeline.use(async (_ctx, _next) => {
        throw new Error('middleware crash');
      });

      await expect(pipeline.execute({})).rejects.toThrow('middleware crash');
    });

    test('error in one middleware prevents subsequent middlewares from running', async () => {
      let secondCalled = false;

      pipeline.use(async (_ctx, _next) => {
        throw new Error('early crash');
      });
      pipeline.use(async (_ctx, next) => {
        secondCalled = true;
        await next();
      });

      try {
        await pipeline.execute({});
      } catch {
        // expected
      }

      expect(secondCalled).toBe(false);
    });

    test('middleware can catch and recover from next() errors', async () => {
      pipeline.use(async (_ctx, next) => {
        try {
          await next();
        } catch {
          // recovered — swallow error
        }
      });
      pipeline.use(async (_ctx, _next) => {
        throw new Error('inner crash');
      });

      // Should not throw because first middleware caught it
      await pipeline.execute({});
    });

    test('async middleware rejection is propagated', async () => {
      pipeline.use(async (_ctx, _next) => {
        await delay(10);
        throw new Error('async rejection');
      });

      await expect(pipeline.execute({})).rejects.toThrow('async rejection');
    });
  });

  describe('empty / edge cases', () => {
    test('empty pipeline completes without error', async () => {
      await pipeline.execute({});
    });

    test('single middleware pipeline works correctly', async () => {
      const mw = makeMiddleware();
      pipeline.use(mw);

      await pipeline.execute({ data: 'test' });
      expect(mw.calls).toHaveLength(1);
    });

    test('execute can be called multiple times', async () => {
      const mw = makeMiddleware();
      pipeline.use(mw);

      await pipeline.execute({});
      await pipeline.execute({});
      await pipeline.execute({});

      expect(mw.calls).toHaveLength(3);
    });

    test('middleware added after execution applies to next execution', async () => {
      const order: number[] = [];
      pipeline.use(async (_ctx, next) => {
        order.push(1);
        await next();
      });

      await pipeline.execute({});
      expect(order).toEqual([1]);

      pipeline.use(async (_ctx, next) => {
        order.push(2);
        await next();
      });
      await pipeline.execute({});
      expect(order).toEqual([1, 1, 2]);
    });
  });

  describe('remove()', () => {
    test('removes a middleware by reference', async () => {
      const mw = makeMiddleware();
      pipeline.use(mw);
      expect(pipeline.size).toBe(1);

      pipeline.remove(mw);
      expect(pipeline.size).toBe(0);
    });

    test('removing non-existent middleware is a no-op', () => {
      const mw = makeMiddleware();
      pipeline.remove(mw); // should not throw
      expect(pipeline.size).toBe(0);
    });
  });

  describe('size', () => {
    test('returns 0 for empty pipeline', () => {
      expect(pipeline.size).toBe(0);
    });

    test('returns correct count after adding middleware', () => {
      pipeline.use(makeMiddleware());
      pipeline.use(makeMiddleware());
      expect(pipeline.size).toBe(2);
    });
  });
});
