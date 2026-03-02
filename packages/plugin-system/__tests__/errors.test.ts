import { describe, expect, test } from 'bun:test';
import { DuplicatePluginError, PluginError, PluginNotFoundError } from '../src/errors.ts';

describe('PluginError', () => {
  test('is an instance of Error', () => {
    const err = new PluginError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PluginError);
  });

  test('has correct name and message', () => {
    const err = new PluginError('something failed');
    expect(err.name).toBe('PluginError');
    expect(err.message).toBe('something failed');
  });

  test('preserves stack trace', () => {
    const err = new PluginError('trace test');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('PluginError');
  });
});

describe('PluginNotFoundError', () => {
  test('extends PluginError', () => {
    const err = new PluginNotFoundError('my-plugin');
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toBeInstanceOf(Error);
  });

  test('has correct name and includes plugin id in message', () => {
    const err = new PluginNotFoundError('my-plugin');
    expect(err.name).toBe('PluginNotFoundError');
    expect(err.message).toContain('my-plugin');
  });
});

describe('DuplicatePluginError', () => {
  test('extends PluginError', () => {
    const err = new DuplicatePluginError('logger');
    expect(err).toBeInstanceOf(PluginError);
    expect(err).toBeInstanceOf(Error);
  });

  test('has correct name and includes plugin name in message', () => {
    const err = new DuplicatePluginError('logger');
    expect(err.name).toBe('DuplicatePluginError');
    expect(err.message).toContain('logger');
  });
});
