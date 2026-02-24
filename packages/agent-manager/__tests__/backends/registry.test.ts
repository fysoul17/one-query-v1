import { describe, expect, test } from 'bun:test';
import type { AIBackend } from '@autonomy/shared';
import { DefaultBackendRegistry } from '../../src/backends/registry.ts';
import { MockBackend } from '../helpers/mock-backend.ts';

describe('DefaultBackendRegistry', () => {
  function makeRegistry(defaultBackend: AIBackend = 'claude') {
    return new DefaultBackendRegistry(defaultBackend);
  }

  describe('register() + get()', () => {
    test('returns a registered backend by name', () => {
      const registry = makeRegistry();
      const claude = new MockBackend('claude' as AIBackend);
      registry.register(claude);
      expect(registry.get('claude' as AIBackend)).toBe(claude);
    });

    test('throws BackendError for unregistered backend', () => {
      const registry = makeRegistry();
      expect(() => registry.get('codex' as AIBackend)).toThrow(/Not registered/);
    });

    test('overwrites existing backend on re-register', () => {
      const registry = makeRegistry();
      const claude1 = new MockBackend('claude' as AIBackend);
      const claude2 = new MockBackend('claude' as AIBackend);
      registry.register(claude1);
      registry.register(claude2);
      expect(registry.get('claude' as AIBackend)).toBe(claude2);
    });
  });

  describe('getDefault()', () => {
    test('returns the default backend', () => {
      const registry = makeRegistry('claude');
      const claude = new MockBackend('claude' as AIBackend);
      registry.register(claude);
      expect(registry.getDefault()).toBe(claude);
    });

    test('throws if default backend is not registered', () => {
      const registry = makeRegistry('gemini');
      expect(() => registry.getDefault()).toThrow(/Not registered/);
    });
  });

  describe('has()', () => {
    test('returns true for registered backend', () => {
      const registry = makeRegistry();
      registry.register(new MockBackend('claude' as AIBackend));
      expect(registry.has('claude' as AIBackend)).toBe(true);
    });

    test('returns false for unregistered backend', () => {
      const registry = makeRegistry();
      expect(registry.has('pi' as AIBackend)).toBe(false);
    });
  });

  describe('list()', () => {
    test('returns all registered backend names', () => {
      const registry = makeRegistry();
      registry.register(new MockBackend('claude' as AIBackend));
      registry.register(new MockBackend('codex' as AIBackend));
      const names = registry.list();
      expect(names).toContain('claude');
      expect(names).toContain('codex');
      expect(names).toHaveLength(2);
    });

    test('returns empty array when no backends registered', () => {
      const registry = makeRegistry();
      expect(registry.list()).toEqual([]);
    });
  });
});
