/**
 * PluginManager — Manages plugin lifecycle: load, unload, shutdown.
 *
 * Plugins register hooks via declarative definitions or via the
 * initialize() callback that receives the HookRegistry.
 *
 * Error isolation: if a plugin's initialize() throws, the plugin is
 * recorded with 'error' status and its hooks are cleaned up.
 */

import { getErrorDetail, Logger } from '@autonomy/shared';
import { DuplicatePluginError, PluginNotFoundError } from './errors.ts';
import type { HookRegistry } from './hook-registry.ts';
import type { PluginDefinition, PluginInfo, PluginStatus } from './types.ts';

interface LoadedPlugin {
  id: string;
  definition: PluginDefinition;
  status: PluginStatus;
  hookCount: number;
}

export class PluginManager {
  private registry: HookRegistry;
  private plugins = new Map<string, LoadedPlugin>();
  private nextId = 0;
  private logger = new Logger({ context: { source: 'plugin-manager' } });

  constructor(registry: HookRegistry) {
    this.registry = registry;
  }

  get pluginCount(): number {
    return this.plugins.size;
  }

  async load(definition: PluginDefinition): Promise<void> {
    if (this.plugins.has(definition.name)) {
      throw new DuplicatePluginError(definition.name);
    }

    const id = `plugin-${++this.nextId}-${definition.name}`;
    let hookCount = 0;
    const unregisterFns: Array<() => void> = [];

    try {
      // Register declarative hooks
      if (definition.hooks) {
        for (const hook of definition.hooks) {
          const unsub = this.registry.register(hook.hookType, hook.handler, {
            priority: hook.priority,
            pluginId: definition.name,
          });
          unregisterFns.push(unsub);
          hookCount++;
        }
      }

      // Call initialize if provided
      if (definition.initialize) {
        await definition.initialize(this.registry);
      }

      this.plugins.set(definition.name, {
        id,
        definition,
        status: 'loaded',
        hookCount,
      });
    } catch (error) {
      // Cleanup registered hooks on failure
      for (const fn of unregisterFns) fn();
      this.registry.unregisterPlugin(definition.name);

      this.plugins.set(definition.name, {
        id,
        definition,
        status: 'error',
        hookCount: 0,
      });

      const detail = getErrorDetail(error);
      this.logger.warn('Failed to load plugin', { plugin: definition.name, error: detail });
    }
  }

  async unload(pluginName: string): Promise<void> {
    const loaded = this.plugins.get(pluginName);
    if (!loaded) {
      throw new PluginNotFoundError(pluginName);
    }

    // Call shutdown (swallow errors)
    if (loaded.definition.shutdown) {
      try {
        await loaded.definition.shutdown();
      } catch (error) {
        const detail = getErrorDetail(error);
        this.logger.warn('Plugin shutdown error', { plugin: pluginName, error: detail });
      }
    }

    // Remove all hooks for this plugin
    this.registry.unregisterPlugin(pluginName);

    this.plugins.delete(pluginName);
  }

  getPlugin(name: string): PluginInfo | undefined {
    const loaded = this.plugins.get(name);
    if (!loaded) return undefined;
    return {
      id: loaded.id,
      name: loaded.definition.name,
      version: loaded.definition.version,
      status: loaded.status,
      hookCount: loaded.hookCount,
    };
  }

  listPlugins(): PluginInfo[] {
    return [...this.plugins.values()].map((loaded) => ({
      id: loaded.id,
      name: loaded.definition.name,
      version: loaded.definition.version,
      status: loaded.status,
      hookCount: loaded.hookCount,
    }));
  }

  async shutdown(): Promise<void> {
    const names = [...this.plugins.keys()];
    for (const name of names) {
      await this.unload(name);
    }
  }
}
