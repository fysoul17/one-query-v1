import { beforeEach, describe, expect, test } from 'bun:test';
import { HookRegistry } from '../src/hook-registry.ts';
import { PluginManager } from '../src/plugin-manager.ts';
import { HookType } from '../src/types.ts';
import { delay, makeHookHandler, makePlugin } from './helpers/fixtures.ts';

describe('Plugin isolation', () => {
  let registry: HookRegistry;
  let manager: PluginManager;

  beforeEach(() => {
    registry = new HookRegistry();
    manager = new PluginManager(registry);
  });

  test('plugin A throwing in hook does not prevent plugin B hook from running', async () => {
    const handlerB = makeHookHandler();

    await manager.load(
      makePlugin({
        name: 'plugin-a',
        hooks: [
          {
            hookType: HookType.ON_MESSAGE,
            handler: () => {
              throw new Error('Plugin A crashed');
            },
            priority: 1,
          },
        ],
      }),
    );
    await manager.load(
      makePlugin({
        name: 'plugin-b',
        hooks: [
          {
            hookType: HookType.ON_MESSAGE,
            handler: handlerB,
            priority: 2,
          },
        ],
      }),
    );

    await registry.emit(HookType.ON_MESSAGE, { content: 'test' });
    expect(handlerB.calls).toHaveLength(1);
  });

  test('plugin throwing during initialize() — load records error status but does not throw', async () => {
    const plugin = makePlugin({
      name: 'bad-init',
      initialize: () => {
        throw new Error('Init crashed');
      },
    });

    // Should NOT throw — error is caught and logged
    await manager.load(plugin);

    const info = manager.getPlugin('bad-init');
    expect(info?.status).toBe('error');

    // System should continue to function
    await manager.load(
      makePlugin({
        name: 'good-plugin',
        hooks: [{ hookType: HookType.ON_MESSAGE, handler: makeHookHandler() }],
      }),
    );
    expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);
  });

  test('plugin throwing during shutdown() — unload logs error but completes', async () => {
    await manager.load(
      makePlugin({
        name: 'bad-shutdown',
        hooks: [{ hookType: HookType.ON_MESSAGE, handler: makeHookHandler() }],
        shutdown: () => {
          throw new Error('Shutdown crashed');
        },
      }),
    );

    // Should not throw — error is swallowed
    await manager.unload('bad-shutdown');

    // Plugin should be removed despite shutdown error
    expect(manager.getPlugin('bad-shutdown')).toBeUndefined();
    expect(registry.getHandlerCount()).toBe(0);
  });

  test('system with zero plugins operates normally', async () => {
    // Emit hooks with no plugins — should not throw
    await registry.emit(HookType.ON_MESSAGE, { content: 'test' });
    await registry.emit(HookType.ON_RESPONSE, { content: 'response' });

    const result = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'original' });
    expect(result).toEqual({ content: 'original' });
  });

  test('system works identically before and after loading/unloading all plugins', async () => {
    // Before plugins
    const resultBefore = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'test' });
    expect(resultBefore).toEqual({ content: 'test' });

    // Load plugins
    await manager.load(
      makePlugin({
        name: 'temp-plugin',
        hooks: [
          {
            hookType: HookType.ON_MESSAGE,
            handler: (data: { content: string }) => ({ content: `${data.content} + modified` }),
          },
        ],
      }),
    );

    // With plugin
    const resultDuring = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'test' });
    expect(resultDuring).toEqual({ content: 'test + modified' });

    // Unload
    await manager.unload('temp-plugin');

    // After plugins — should be back to normal
    const resultAfter = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'test' });
    expect(resultAfter).toEqual({ content: 'test' });
  });

  test('hot-reload: unload + reload a plugin mid-operation', async () => {
    const _version = 1;
    const pluginV1 = makePlugin({
      name: 'hot-reload',
      hooks: [
        {
          hookType: HookType.ON_MESSAGE,
          handler: (data: { content: string }) => ({ content: `${data.content} v1` }),
        },
      ],
    });

    await manager.load(pluginV1);

    const r1 = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'msg' });
    expect(r1).toEqual({ content: 'msg v1' });

    // Unload v1, load v2
    await manager.unload('hot-reload');

    const pluginV2 = makePlugin({
      name: 'hot-reload',
      hooks: [
        {
          hookType: HookType.ON_MESSAGE,
          handler: (data: { content: string }) => ({ content: `${data.content} v2` }),
        },
      ],
    });
    await manager.load(pluginV2);

    const r2 = await registry.emitWaterfall(HookType.ON_MESSAGE, { content: 'msg' });
    expect(r2).toEqual({ content: 'msg v2' });
  });

  test('multiple plugins registering for same hook — all execute', async () => {
    const handlerA = makeHookHandler();
    const handlerB = makeHookHandler();
    const handlerC = makeHookHandler();

    await manager.load(
      makePlugin({
        name: 'multi-a',
        hooks: [{ hookType: HookType.ON_AGENT_START, handler: handlerA }],
      }),
    );
    await manager.load(
      makePlugin({
        name: 'multi-b',
        hooks: [{ hookType: HookType.ON_AGENT_START, handler: handlerB }],
      }),
    );
    await manager.load(
      makePlugin({
        name: 'multi-c',
        hooks: [{ hookType: HookType.ON_AGENT_START, handler: handlerC }],
      }),
    );

    await registry.emit(HookType.ON_AGENT_START, { agentId: 'agent-1' });

    expect(handlerA.calls).toHaveLength(1);
    expect(handlerB.calls).toHaveLength(1);
    expect(handlerC.calls).toHaveLength(1);
  });

  test('unloading one plugin does not affect hooks registered via initialize()', async () => {
    // Plugin A registers hooks via initialize()
    const aHandler = makeHookHandler();
    await manager.load(
      makePlugin({
        name: 'init-register',
        initialize: (reg) => {
          reg.register(HookType.ON_MESSAGE, aHandler, { pluginId: 'init-register' });
        },
      }),
    );

    // Plugin B registers via declarative hooks
    await manager.load(
      makePlugin({
        name: 'decl-register',
        hooks: [{ hookType: HookType.ON_MESSAGE, handler: makeHookHandler() }],
      }),
    );

    expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(2);

    // Unload B
    await manager.unload('decl-register');
    expect(registry.getHandlerCount(HookType.ON_MESSAGE)).toBe(1);

    // A's handler should still fire
    await registry.emit(HookType.ON_MESSAGE, { test: true });
    expect(aHandler.calls).toHaveLength(1);
  });

  test('slow plugin hook does not indefinitely block other hooks', async () => {
    const fastHandler = makeHookHandler();

    await manager.load(
      makePlugin({
        name: 'slow-plugin',
        hooks: [
          {
            hookType: HookType.ON_AGENT_START,
            handler: async () => {
              await delay(50);
            },
            priority: 1,
          },
        ],
      }),
    );
    await manager.load(
      makePlugin({
        name: 'fast-plugin',
        hooks: [
          {
            hookType: HookType.ON_AGENT_START,
            handler: fastHandler,
            priority: 2,
          },
        ],
      }),
    );

    const start = performance.now();
    await registry.emit(HookType.ON_AGENT_START, {});
    const elapsed = performance.now() - start;

    // Fast handler should have been called (even if it waited for slow one)
    expect(fastHandler.calls).toHaveLength(1);
    // Total time should be reasonable (not infinite)
    expect(elapsed).toBeLessThan(5000);
  });
});
