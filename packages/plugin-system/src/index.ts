/**
 * @autonomy/plugin-system — Event hook system, middleware pipeline, plugin lifecycle.
 */

export {
  DuplicatePluginError,
  HookError,
  PluginError,
  PluginNotFoundError,
} from './errors.ts';
export { HookRegistry } from './hook-registry.ts';
export { PluginManager } from './plugin-manager.ts';

export {
  type HookHandler,
  type HookRegistration,
  type HookRegistryInterface,
  HookType,
  type Middleware,
  type PluginDefinition,
  type PluginInfo,
  type PluginStatus,
} from './types.ts';
