/**
 * Plugin system error classes.
 *
 * Follows the same error hierarchy pattern as @autonomy/conductor errors.
 */

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginError';
  }
}

export class PluginNotFoundError extends PluginError {
  constructor(pluginId: string) {
    super(`Plugin not found: "${pluginId}"`);
    this.name = 'PluginNotFoundError';
  }
}

export class DuplicatePluginError extends PluginError {
  constructor(pluginName: string) {
    super(`Plugin already loaded: "${pluginName}"`);
    this.name = 'DuplicatePluginError';
  }
}
