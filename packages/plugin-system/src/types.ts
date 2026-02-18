/**
 * Plugin system type definitions.
 *
 * Defines the contract for hooks, middleware, and plugin lifecycle.
 */

// ---- Hook Types ----

export const HookType = {
  /** Fires before conductor processes a message. Waterfall: can transform the message. */
  ON_MESSAGE: 'onMessage',
  /** Fires after conductor generates a response. Waterfall: can transform the response. */
  ON_RESPONSE: 'onResponse',
  /** Fires before an agent is created. Waterfall: can modify the definition. */
  ON_AGENT_CREATE: 'onAgentCreate',
  /** Fires after an agent is deleted. Fire-and-forget notification. */
  ON_AGENT_DELETE: 'onAgentDelete',
  /** Fires before data is stored to memory. Waterfall: can transform the data. */
  ON_MEMORY_STORE: 'onMemoryStore',
  /** Fires when an agent process starts. Fire-and-forget notification. */
  ON_AGENT_START: 'onAgentStart',
  /** Fires when an agent process stops. Fire-and-forget notification. */
  ON_AGENT_STOP: 'onAgentStop',
  /** Fires when an agent process encounters an error. Fire-and-forget notification. */
  ON_AGENT_ERROR: 'onAgentError',
} as const;
export type HookType = (typeof HookType)[keyof typeof HookType];

// Re-export shared types so consumers can import from plugin-system
export type { HookHandler, HookRegistryInterface } from '@autonomy/shared';

import type { HookHandler, HookRegistryInterface } from '@autonomy/shared';

// ---- Hook Registration ----

export interface HookRegistration {
  /** The hook type this handler is registered for. */
  hookType: string;
  /** The handler function. */
  handler: HookHandler;
  /** Lower numbers execute first. Default: 100. */
  priority: number;
  /** The plugin that registered this hook (for cleanup). */
  pluginId?: string;
}

// ---- Middleware ----

export type Middleware<TContext = Record<string, unknown>> = (
  ctx: TContext,
  next: () => Promise<void>,
) => Promise<void>;

// ---- Plugin Definition ----

export interface PluginDefinition {
  /** Unique plugin name. */
  name: string;
  /** Semantic version string. */
  version: string;
  /** Optional description. */
  description?: string;
  /** Called when the plugin is loaded. */
  initialize?: (registry: HookRegistryInterface) => void | Promise<void>;
  /** Called when the plugin is unloaded. */
  shutdown?: () => void | Promise<void>;
  /** Declarative hook registrations (alternative to initialize). */
  hooks?: Array<{
    hookType: HookType;
    handler: HookHandler;
    priority?: number;
  }>;
  /** Declarative middleware registrations. */
  middleware?: Array<{
    name: string;
    handler: Middleware;
    priority?: number;
  }>;
}

export type PluginStatus = 'loaded' | 'error' | 'unloaded';

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  status: PluginStatus;
  hookCount: number;
}
