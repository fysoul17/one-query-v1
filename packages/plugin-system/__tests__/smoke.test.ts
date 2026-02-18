import { describe, expect, test } from 'bun:test';
import {
  DuplicatePluginError,
  HookError,
  HookRegistry,
  HookType,
  MiddlewareError,
  MiddlewarePipeline,
  PluginError,
  PluginManager,
  PluginNotFoundError,
} from '../src/index.ts';

describe('plugin-system smoke tests', () => {
  test('package is importable', () => {
    expect(HookRegistry).toBeDefined();
    expect(MiddlewarePipeline).toBeDefined();
    expect(PluginManager).toBeDefined();
  });

  test('all error classes are exported', () => {
    expect(PluginError).toBeDefined();
    expect(PluginNotFoundError).toBeDefined();
    expect(DuplicatePluginError).toBeDefined();
    expect(HookError).toBeDefined();
    expect(MiddlewareError).toBeDefined();
  });

  test('HookType enum is exported with expected values', () => {
    expect(HookType).toBeDefined();
    expect(HookType.ON_MESSAGE).toBe('onMessage');
    expect(HookType.ON_RESPONSE).toBe('onResponse');
    expect(HookType.ON_AGENT_CREATE).toBe('onAgentCreate');
    expect(HookType.ON_AGENT_DELETE).toBe('onAgentDelete');
    expect(HookType.ON_MEMORY_STORE).toBe('onMemoryStore');
    expect(HookType.ON_AGENT_START).toBe('onAgentStart');
    expect(HookType.ON_AGENT_STOP).toBe('onAgentStop');
    expect(HookType.ON_AGENT_ERROR).toBe('onAgentError');
    expect(Object.keys(HookType)).toHaveLength(8);
  });

  test('HookRegistry is instantiable', () => {
    const registry = new HookRegistry();
    expect(registry).toBeDefined();
    expect(registry.getHandlerCount()).toBe(0);
  });

  test('PluginManager is instantiable', () => {
    const registry = new HookRegistry();
    const manager = new PluginManager(registry);
    expect(manager).toBeDefined();
  });
});
