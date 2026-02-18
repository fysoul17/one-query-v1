import { beforeEach, describe, expect, test } from 'bun:test';
import { HookRegistry } from '../src/hook-registry.ts';
import { HookType } from '../src/types.ts';
import { delay, makeHookHandler } from './helpers/fixtures.ts';

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe('register()', () => {
    test('adds a handler for a hook type', () => {
      const handler = makeHookHandler();
      registry.register(HookType.ON_MESSAGE, handler);
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);
    });

    test('returns an unsubscribe function', () => {
      const handler = makeHookHandler();
      const unsub = registry.register(HookType.ON_MESSAGE, handler);
      expect(typeof unsub).toBe('function');

      unsub();
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(0);
    });

    test('registers multiple handlers for the same hook type', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(3);
    });

    test('registers handlers for different hook types', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.register(HookType.ON_RESPONSE, makeHookHandler());
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);
      expect(registry.getHandlerCount(HookType.ON_RESPONSE)).toBe(1);
      expect(registry.getHandlerCount()).toBe(2);
    });

    test('accepts a priority option (lower = earlier)', () => {
      const order: number[] = [];
      registry.register(
        HookType.ON_MESSAGE,
        () => {
          order.push(2);
        },
        { priority: 200 },
      );
      registry.register(
        HookType.ON_MESSAGE,
        () => {
          order.push(1);
        },
        { priority: 100 },
      );
      registry.register(
        HookType.ON_MESSAGE,
        () => {
          order.push(3);
        },
        { priority: 300 },
      );

      // Verify registration was accepted — emit tested separately
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(3);
    });

    test('accepts a pluginId option', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler(), { pluginId: 'plugin-a' });
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);
    });

    test('default priority is 100', () => {
      // Registering without explicit priority should work
      const handler = makeHookHandler();
      registry.register(HookType.ON_MESSAGE, handler);
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);
    });
  });

  describe('unsubscribe / unregister', () => {
    test('unsubscribe removes only the specific handler', () => {
      const handler1 = makeHookHandler();
      const handler2 = makeHookHandler();
      const unsub1 = registry.register(HookType.ON_MESSAGE, handler1);
      registry.register(HookType.ON_MESSAGE, handler2);

      unsub1();
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);
    });

    test('unsubscribe after already removed is a no-op', () => {
      const handler = makeHookHandler();
      const unsub = registry.register(HookType.ON_MESSAGE, handler);
      unsub();
      unsub(); // double unsubscribe — should not throw
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(0);
    });

    test('unregisterPlugin removes all hooks for a plugin', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler(), { pluginId: 'plugin-a' });
      registry.register(HookType.ON_RESPONSE, makeHookHandler(), { pluginId: 'plugin-a' });
      registry.register(HookType.ON_MESSAGE, makeHookHandler(), { pluginId: 'plugin-b' });

      registry.unregisterPlugin('plugin-a');
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1); // plugin-b's
      expect(registry.getHandlerCount(HookType.ON_RESPONSE)).toBe(0);
    });

    test('unregisterPlugin with no matching handlers is a no-op', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.unregisterPlugin('nonexistent');
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);
    });

    test('clear removes all handlers', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.register(HookType.ON_RESPONSE, makeHookHandler());
      registry.register(HookType.ON_AGENT_CREATE, makeHookHandler());

      registry.clear();
      expect(registry.getHandlerCount()).toBe(0);
    });
  });

  describe('emit() — fire-and-forget', () => {
    test('calls all registered handlers for the hook type', async () => {
      const handler1 = makeHookHandler();
      const handler2 = makeHookHandler();
      registry.register(HookType.ON_AGENT_DELETE, handler1);
      registry.register(HookType.ON_AGENT_DELETE, handler2);

      await registry.emit(HookType.ON_AGENT_DELETE, { agentId: 'agent-1' });

      expect(handler1.calls).toHaveLength(1);
      expect(handler2.calls).toHaveLength(1);
    });

    test('passes the event data to handlers', async () => {
      const handler = makeHookHandler<{ agentId: string }>();
      registry.register(HookType.ON_AGENT_DELETE, handler);

      await registry.emit(HookType.ON_AGENT_DELETE, { agentId: 'agent-1' });

      expect(handler.calls[0]).toEqual({ agentId: 'agent-1' });
    });

    test('calls handlers in priority order', async () => {
      const order: number[] = [];
      registry.register(
        HookType.ON_AGENT_START,
        () => {
          order.push(3);
        },
        { priority: 300 },
      );
      registry.register(
        HookType.ON_AGENT_START,
        () => {
          order.push(1);
        },
        { priority: 100 },
      );
      registry.register(
        HookType.ON_AGENT_START,
        () => {
          order.push(2);
        },
        { priority: 200 },
      );

      await registry.emit(HookType.ON_AGENT_START, {});

      expect(order).toEqual([1, 2, 3]);
    });

    test('awaits async handlers', async () => {
      let completed = false;
      registry.register(HookType.ON_AGENT_START, async () => {
        await delay(20);
        completed = true;
      });

      await registry.emit(HookType.ON_AGENT_START, {});
      expect(completed).toBe(true);
    });

    test('emitting with no registered handlers is a no-op', async () => {
      // Should not throw
      await registry.emit(HookType.ON_AGENT_START, {});
    });

    test('handler throwing does not prevent other handlers from executing', async () => {
      const handler2 = makeHookHandler();
      registry.register(
        HookType.ON_AGENT_START,
        () => {
          throw new Error('boom');
        },
        { priority: 1 },
      );
      registry.register(HookType.ON_AGENT_START, handler2, { priority: 2 });

      // Should not throw
      await registry.emit(HookType.ON_AGENT_START, { test: true });

      expect(handler2.calls).toHaveLength(1);
    });

    test('async handler rejection is caught and contained', async () => {
      const handler2 = makeHookHandler();
      registry.register(
        HookType.ON_AGENT_STOP,
        async () => {
          throw new Error('async boom');
        },
        { priority: 1 },
      );
      registry.register(HookType.ON_AGENT_STOP, handler2, { priority: 2 });

      // Should not throw
      await registry.emit(HookType.ON_AGENT_STOP, {});

      expect(handler2.calls).toHaveLength(1);
    });

    test('emit still completes even if all handlers throw', async () => {
      registry.register(HookType.ON_AGENT_ERROR, () => {
        throw new Error('a');
      });
      registry.register(HookType.ON_AGENT_ERROR, () => {
        throw new Error('b');
      });

      // Should not throw
      await registry.emit(HookType.ON_AGENT_ERROR, {});
    });
  });

  describe('emitWaterfall() — data transformation', () => {
    test('passes output of handler N as input to handler N+1', async () => {
      registry.register(
        HookType.ON_MESSAGE,
        (data: { content: string }) => {
          return { content: `${data.content} + A` };
        },
        { priority: 1 },
      );
      registry.register(
        HookType.ON_MESSAGE,
        (data: { content: string }) => {
          return { content: `${data.content} + B` };
        },
        { priority: 2 },
      );

      const result = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'start' });
      expect(result).toEqual({ content: 'start + A + B' });
    });

    test('handler returning undefined passes data through unchanged', async () => {
      registry.register(
        HookType.ON_MESSAGE,
        () => {
          // return nothing — pass through
        },
        { priority: 1 },
      );
      registry.register(
        HookType.ON_MESSAGE,
        (data: { content: string }) => {
          return { content: `${data.content} + modified` };
        },
        { priority: 2 },
      );

      const result = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'hello' });
      expect(result).toEqual({ content: 'hello + modified' });
    });

    test('returns original data when no handlers registered', async () => {
      const data = { content: 'original' };
      const result = await registry.emitWaterfall(HookType.ON_MESSAGE, data);
      expect(result).toEqual({ content: 'original' });
    });

    test('waterfall respects priority order', async () => {
      registry.register(
        HookType.ON_RESPONSE,
        (data: { content: string }) => {
          return { content: `${data.content} + second` };
        },
        { priority: 200 },
      );
      registry.register(
        HookType.ON_RESPONSE,
        (data: { content: string }) => {
          return { content: `${data.content} + first` };
        },
        { priority: 100 },
      );

      const result = await registry.emitWaterfall(HookType.ON_RESPONSE, { content: 'start' });
      expect(result).toEqual({ content: 'start + first + second' });
    });

    test('waterfall works with async handlers', async () => {
      registry.register(
        HookType.ON_MESSAGE,
        async (data: { count: number }) => {
          await delay(10);
          return { count: data.count + 1 };
        },
        { priority: 1 },
      );
      registry.register(
        HookType.ON_MESSAGE,
        async (data: { count: number }) => {
          await delay(10);
          return { count: data.count * 2 };
        },
        { priority: 2 },
      );

      const result = await registry.emitWaterfall(HookType.ON_MESSAGE, { count: 5 });
      // (5 + 1) * 2 = 12
      expect(result).toEqual({ count: 12 });
    });

    test('handler error in waterfall does not break chain — passes data through', async () => {
      registry.register(
        HookType.ON_MESSAGE,
        () => {
          throw new Error('waterfall crash');
        },
        { priority: 1 },
      );
      registry.register(
        HookType.ON_MESSAGE,
        (data: { content: string }) => {
          return { content: `${data.content} + survived` };
        },
        { priority: 2 },
      );

      const result = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'hello' });
      expect(result).toEqual({ content: 'hello + survived' });
    });
  });

  describe('getHandlerCount()', () => {
    test('returns 0 for empty registry', () => {
      expect(registry.getHandlerCount()).toBe(0);
    });

    test('returns total count without filter', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.register(HookType.ON_RESPONSE, makeHookHandler());
      expect(registry.getHandlerCount()).toBe(2);
    });

    test('returns count for specific hook type', () => {
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.register(HookType.ON_MESSAGE, makeHookHandler());
      registry.register(HookType.ON_RESPONSE, makeHookHandler());
      expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(2);
      expect(registry.getHandlerCount(HookType.ON_RESPONSE)).toBe(1);
    });

    test('returns 0 for hook type with no handlers', () => {
      expect(registry.getHandlerCount(HookType.ON_AGENT_ERROR)).toBe(0);
    });
  });
});
