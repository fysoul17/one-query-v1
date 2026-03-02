import { beforeEach, describe, expect, test } from 'bun:test';
import { DuplicatePluginError, PluginNotFoundError } from '../src/errors.ts';
import { HookRegistry } from '../src/hook-registry.ts';
import { PluginManager } from '../src/plugin-manager.ts';
import { HookType } from '../src/types.ts';
import { makeHookHandler, makePlugin } from './helpers/fixtures.ts';

describe('PluginManager', () => {
  let registry: HookRegistry;
  let manager: PluginManager;

  beforeEach(() => {
    registry = new HookRegistry();
    manager = new PluginManager(registry);
  });

  describe('load()', () => {
    test('loads a plugin definition', async () => {
      const plugin = makePlugin({ name: 'logger' });
      await manager.load(plugin);

      const info = manager.listPlugins();
      expect(info).toHaveLength(1);
      expect(info[0].name).toBe('logger');
      expect(info[0].status).toBe('loaded');
    });

    test('calls plugin initialize() if provided', async () => {
      let initCalled = false;
      const plugin = makePlugin({
        name: 'init-test',
        initialize: () => {
          initCalled = true;
        },
      });

      await manager.load(plugin);
      expect(initCalled).toBe(true);
    });

    test('passes registry to initialize()', async () => {
      let receivedRegistry: unknown = null;
      const plugin = makePlugin({
        name: 'registry-test',
        initialize: (reg) => {
          receivedRegistry = reg;
        },
      });

      await manager.load(plugin);
      expect(receivedRegistry).toBeDefined();
    });

    test('registers all declarative hooks from plugin definition', async () => {
      const handler = makeHookHandler();
      const plugin = makePlugin({
        name: 'hooks-test',
        hooks: [
          { hookType: HookType.BEFORE_MESSAGE, handler },
          { hookType: HookType.AFTER_RESPONSE, handler },
        ],
      });

      await manager.load(plugin);
      expect(registry.getHandlerCount(HookType.BEFORE_MESSAGE)).toBe(1);
      expect(registry.getHandlerCount(HookType.AFTER_RESPONSE)).toBe(1);
    });

    test('assigns a unique plugin ID', async () => {
      const plugin = makePlugin({ name: 'id-test' });
      await manager.load(plugin);

      const info = manager.listPlugins();
      expect(info[0].id).toBeDefined();
      expect(info[0].id.length).toBeGreaterThan(0);
    });

    test('throws DuplicatePluginError for duplicate plugin name', async () => {
      await manager.load(makePlugin({ name: 'dup' }));

      try {
        await manager.load(makePlugin({ name: 'dup' }));
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicatePluginError);
      }
    });

    test('getPlugin returns loaded plugin by name', async () => {
      await manager.load(makePlugin({ name: 'findme', version: '2.0.0' }));

      const info = manager.getPlugin('findme');
      expect(info).toBeDefined();
      expect(info?.name).toBe('findme');
      expect(info?.version).toBe('2.0.0');
    });

    test('getPlugin returns undefined for non-existent plugin', () => {
      expect(manager.getPlugin('nope')).toBeUndefined();
    });

    test('listPlugins returns all loaded plugins with status', async () => {
      await manager.load(makePlugin({ name: 'a' }));
      await manager.load(makePlugin({ name: 'b' }));
      await manager.load(makePlugin({ name: 'c' }));

      const list = manager.listPlugins();
      expect(list).toHaveLength(3);
      expect(list.every((p) => p.status === 'loaded')).toBe(true);
    });

    test('listPlugins includes hookCount', async () => {
      const plugin = makePlugin({
        name: 'hook-count-test',
        hooks: [
          { hookType: HookType.BEFORE_MESSAGE, handler: makeHookHandler() },
          { hookType: HookType.AFTER_RESPONSE, handler: makeHookHandler() },
          { hookType: HookType.BEFORE_AGENT_CREATE, handler: makeHookHandler() },
        ],
      });
      await manager.load(plugin);

      const list = manager.listPlugins();
      expect(list[0].hookCount).toBe(3);
    });

    test('hook priority from plugin definition is respected', async () => {
      const order: number[] = [];
      const pluginA = makePlugin({
        name: 'plugin-a',
        hooks: [
          {
            hookType: HookType.BEFORE_MESSAGE,
            handler: () => {
              order.push(2);
            },
            priority: 200,
          },
        ],
      });
      const pluginB = makePlugin({
        name: 'plugin-b',
        hooks: [
          {
            hookType: HookType.BEFORE_MESSAGE,
            handler: () => {
              order.push(1);
            },
            priority: 100,
          },
        ],
      });

      await manager.load(pluginA);
      await manager.load(pluginB);

      await registry.emit(HookType.BEFORE_MESSAGE, {});
      expect(order).toEqual([1, 2]);
    });
  });

  describe('unload()', () => {
    test('calls plugin shutdown() if provided', async () => {
      let shutdownCalled = false;
      const plugin = makePlugin({
        name: 'shutdown-test',
        shutdown: () => {
          shutdownCalled = true;
        },
      });

      await manager.load(plugin);
      await manager.unload('shutdown-test');
      expect(shutdownCalled).toBe(true);
    });

    test('removes all hooks registered by the plugin', async () => {
      const plugin = makePlugin({
        name: 'cleanup-hooks',
        hooks: [
          { hookType: HookType.BEFORE_MESSAGE, handler: makeHookHandler() },
          { hookType: HookType.AFTER_RESPONSE, handler: makeHookHandler() },
        ],
      });

      await manager.load(plugin);
      expect(registry.getHandlerCount()).toBe(2);

      await manager.unload('cleanup-hooks');
      expect(registry.getHandlerCount()).toBe(0);
    });

    test('removes plugin from registry', async () => {
      await manager.load(makePlugin({ name: 'to-remove' }));
      await manager.unload('to-remove');

      expect(manager.getPlugin('to-remove')).toBeUndefined();
      expect(manager.listPlugins()).toHaveLength(0);
    });

    test('throws PluginNotFoundError for non-existent plugin', async () => {
      try {
        await manager.unload('nonexistent');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PluginNotFoundError);
      }
    });

    test('does not affect other plugins hooks', async () => {
      await manager.load(
        makePlugin({
          name: 'keep-me',
          hooks: [{ hookType: HookType.BEFORE_MESSAGE, handler: makeHookHandler() }],
        }),
      );
      await manager.load(
        makePlugin({
          name: 'remove-me',
          hooks: [{ hookType: HookType.BEFORE_MESSAGE, handler: makeHookHandler() }],
        }),
      );

      expect(registry.getHandlerCount(HookType.BEFORE_MESSAGE)).toBe(2);

      await manager.unload('remove-me');
      expect(registry.getHandlerCount(HookType.BEFORE_MESSAGE)).toBe(1);
    });
  });

  describe('plugin lifecycle', () => {
    test('plugin can be reloaded after unload', async () => {
      const plugin = makePlugin({ name: 'reload-test' });

      await manager.load(plugin);
      await manager.unload('reload-test');
      await manager.load(plugin);

      expect(manager.getPlugin('reload-test')).toBeDefined();
      expect(manager.listPlugins()).toHaveLength(1);
    });

    test('shutdown() unloads all plugins', async () => {
      let shutdownA = false;
      let shutdownB = false;

      await manager.load(
        makePlugin({
          name: 'a',
          shutdown: () => {
            shutdownA = true;
          },
          hooks: [{ hookType: HookType.BEFORE_MESSAGE, handler: makeHookHandler() }],
        }),
      );
      await manager.load(
        makePlugin({
          name: 'b',
          shutdown: () => {
            shutdownB = true;
          },
          hooks: [{ hookType: HookType.AFTER_RESPONSE, handler: makeHookHandler() }],
        }),
      );

      await manager.shutdown();

      expect(shutdownA).toBe(true);
      expect(shutdownB).toBe(true);
      expect(manager.listPlugins()).toHaveLength(0);
      expect(registry.getHandlerCount()).toBe(0);
    });

    test('plugin loading order is preserved in listPlugins()', async () => {
      await manager.load(makePlugin({ name: 'first' }));
      await manager.load(makePlugin({ name: 'second' }));
      await manager.load(makePlugin({ name: 'third' }));

      const names = manager.listPlugins().map((p) => p.name);
      expect(names).toEqual(['first', 'second', 'third']);
    });

    test('async initialize is awaited', async () => {
      let initialized = false;
      const plugin = makePlugin({
        name: 'async-init',
        initialize: async () => {
          await new Promise((r) => setTimeout(r, 20));
          initialized = true;
        },
      });

      await manager.load(plugin);
      expect(initialized).toBe(true);
    });

    test('async shutdown is awaited', async () => {
      let shutdownComplete = false;
      const plugin = makePlugin({
        name: 'async-shutdown',
        shutdown: async () => {
          await new Promise((r) => setTimeout(r, 20));
          shutdownComplete = true;
        },
      });

      await manager.load(plugin);
      await manager.unload('async-shutdown');
      expect(shutdownComplete).toBe(true);
    });
  });
});
