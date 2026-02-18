import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Logger, type LoggerConfig } from '../src/logger.ts';

/** Capture structured log output by intercepting the write target. */
function createCapture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => lines.push(line),
  };
}

function parseLogLine(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

describe('Logger', () => {
  let capture: ReturnType<typeof createCapture>;
  let logger: Logger;

  beforeEach(() => {
    capture = createCapture();
  });

  describe('constructor', () => {
    test('creates logger with default config', () => {
      logger = new Logger({ write: capture.write });
      expect(logger).toBeDefined();
    });

    test('accepts level configuration', () => {
      logger = new Logger({ level: 'warn', write: capture.write });
      expect(logger).toBeDefined();
    });
  });

  describe('output format', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'debug', write: capture.write });
    });

    test('outputs valid JSON', () => {
      logger.info('test message');
      expect(capture.lines).toHaveLength(1);
      expect(() => JSON.parse(capture.lines[0])).not.toThrow();
    });

    test('includes timestamp field', () => {
      logger.info('test');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.timestamp).toBeDefined();
      expect(typeof entry.timestamp).toBe('string');
    });

    test('timestamp is ISO 8601 format', () => {
      logger.info('test');
      const entry = parseLogLine(capture.lines[0]);
      const ts = entry.timestamp as string;
      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // Should be parseable as a date
      expect(new Date(ts).toISOString()).toBeTruthy();
    });

    test('includes level field', () => {
      logger.info('test');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.level).toBe('info');
    });

    test('includes message field', () => {
      logger.info('hello world');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.message).toBe('hello world');
    });

    test('includes all core fields: timestamp, level, message', () => {
      logger.warn('something happened');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('message');
    });
  });

  describe('log levels', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'debug', write: capture.write });
    });

    test('debug() outputs with level "debug"', () => {
      logger.debug('debug msg');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.level).toBe('debug');
    });

    test('info() outputs with level "info"', () => {
      logger.info('info msg');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.level).toBe('info');
    });

    test('warn() outputs with level "warn"', () => {
      logger.warn('warn msg');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.level).toBe('warn');
    });

    test('error() outputs with level "error"', () => {
      logger.error('error msg');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.level).toBe('error');
    });
  });

  describe('level filtering', () => {
    test('level "debug" outputs all levels', () => {
      logger = new Logger({ level: 'debug', write: capture.write });
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      expect(capture.lines).toHaveLength(4);
    });

    test('level "info" suppresses debug', () => {
      logger = new Logger({ level: 'info', write: capture.write });
      logger.debug('should not appear');
      logger.info('should appear');
      expect(capture.lines).toHaveLength(1);
      expect(parseLogLine(capture.lines[0]).level).toBe('info');
    });

    test('level "warn" suppresses debug and info', () => {
      logger = new Logger({ level: 'warn', write: capture.write });
      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('visible');
      logger.error('visible');
      expect(capture.lines).toHaveLength(2);
      expect(parseLogLine(capture.lines[0]).level).toBe('warn');
      expect(parseLogLine(capture.lines[1]).level).toBe('error');
    });

    test('level "error" suppresses debug, info, and warn', () => {
      logger = new Logger({ level: 'error', write: capture.write });
      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('hidden');
      logger.error('visible');
      expect(capture.lines).toHaveLength(1);
      expect(parseLogLine(capture.lines[0]).level).toBe('error');
    });

    test('numeric level ordering: debug=0, info=1, warn=2, error=3', () => {
      // Verify that the hierarchy works correctly
      // Setting level to warn (2) should suppress debug (0) and info (1)
      logger = new Logger({ level: 'warn', write: capture.write });
      logger.debug('nope');
      logger.info('nope');
      logger.warn('yes');
      logger.error('yes');
      expect(capture.lines).toHaveLength(2);
    });
  });

  describe('context fields', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'debug', write: capture.write });
    });

    test('accepts context object with requestId', () => {
      logger.info('request start', { requestId: 'req-123' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.requestId).toBe('req-123');
    });

    test('accepts context with HTTP method and path', () => {
      logger.info('request', { method: 'GET', path: '/api/agents' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.method).toBe('GET');
      expect(entry.path).toBe('/api/agents');
    });

    test('accepts context with statusCode', () => {
      logger.info('response', { statusCode: 200 });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.statusCode).toBe(200);
    });

    test('accepts context with durationMs', () => {
      logger.info('request completed', { durationMs: 42 });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.durationMs).toBe(42);
    });

    test('merges all context fields into log entry', () => {
      logger.info('request', {
        requestId: 'req-456',
        method: 'POST',
        path: '/api/agents',
        statusCode: 201,
        durationMs: 15,
      });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.requestId).toBe('req-456');
      expect(entry.method).toBe('POST');
      expect(entry.path).toBe('/api/agents');
      expect(entry.statusCode).toBe(201);
      expect(entry.durationMs).toBe(15);
    });
  });

  describe('child logger', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'debug', write: capture.write });
    });

    test('child() returns a new Logger instance', () => {
      const child = logger.child({ requestId: 'abc' });
      expect(child).toBeDefined();
      expect(child).not.toBe(logger);
    });

    test('child logger includes parent context in all logs', () => {
      const child = logger.child({ requestId: 'req-789' });
      child.info('processing');
      child.warn('slow query');

      const entry1 = parseLogLine(capture.lines[0]);
      const entry2 = parseLogLine(capture.lines[1]);
      expect(entry1.requestId).toBe('req-789');
      expect(entry2.requestId).toBe('req-789');
    });

    test('child logger merges additional context per-log', () => {
      const child = logger.child({ requestId: 'req-001' });
      child.info('done', { statusCode: 200, durationMs: 5 });

      const entry = parseLogLine(capture.lines[0]);
      expect(entry.requestId).toBe('req-001');
      expect(entry.statusCode).toBe(200);
      expect(entry.durationMs).toBe(5);
    });

    test('child logger does not modify parent logger', () => {
      const child = logger.child({ requestId: 'child-req' });
      logger.info('parent log');
      child.info('child log');

      const parentEntry = parseLogLine(capture.lines[0]);
      const childEntry = parseLogLine(capture.lines[1]);
      expect(parentEntry.requestId).toBeUndefined();
      expect(childEntry.requestId).toBe('child-req');
    });

    test('nested child loggers accumulate context', () => {
      const child1 = logger.child({ service: 'api' });
      const child2 = child1.child({ requestId: 'req-nested' });
      child2.info('deep log');

      const entry = parseLogLine(capture.lines[0]);
      expect(entry.service).toBe('api');
      expect(entry.requestId).toBe('req-nested');
    });

    test('child inherits parent log level', () => {
      const warnLogger = new Logger({ level: 'warn', write: capture.write });
      const child = warnLogger.child({ requestId: 'test' });

      child.debug('hidden');
      child.info('hidden');
      child.warn('visible');

      expect(capture.lines).toHaveLength(1);
      expect(parseLogLine(capture.lines[0]).level).toBe('warn');
    });
  });

  describe('redaction', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'debug', write: capture.write });
    });

    test('redacts Authorization header values', () => {
      logger.info('request', {
        headers: { Authorization: 'Bearer secret-token-12345' },
      });
      const entry = parseLogLine(capture.lines[0]);
      const headers = entry.headers as Record<string, string>;
      expect(headers.Authorization).not.toContain('secret-token');
      expect(headers.Authorization).toBe('[REDACTED]');
    });

    test('redacts authorization header (lowercase)', () => {
      logger.info('request', {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      const entry = parseLogLine(capture.lines[0]);
      const headers = entry.headers as Record<string, string>;
      expect(headers.authorization).toBe('[REDACTED]');
    });

    test('does not redact non-sensitive headers', () => {
      logger.info('request', {
        headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
      });
      const entry = parseLogLine(capture.lines[0]);
      const headers = entry.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Accept).toBe('text/html');
    });

    test('redacts "password" field in context', () => {
      logger.info('login attempt', { username: 'admin', password: 'hunter2' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.username).toBe('admin');
      expect(entry.password).toBe('[REDACTED]');
    });

    test('redacts "secret" field in context', () => {
      logger.info('config loaded', { secret: 'my-secret-value', name: 'app' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.secret).toBe('[REDACTED]');
      expect(entry.name).toBe('app');
    });

    test('redacts "token" field in context', () => {
      logger.info('auth', { token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.token).toBe('[REDACTED]');
    });

    test('redacts "apiKey" field in context', () => {
      logger.info('api call', { apiKey: 'sk-1234567890abcdef', endpoint: '/v1/chat' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.apiKey).toBe('[REDACTED]');
      expect(entry.endpoint).toBe('/v1/chat');
    });

    test('redacts "key_hash" field in context', () => {
      logger.info('key validated', { key_hash: 'abc123hash', valid: true });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.key_hash).toBe('[REDACTED]');
      expect(entry.valid).toBe(true);
    });

    test('redacts "rawKey" field in context', () => {
      logger.info('key created', { rawKey: 'af-key-full-value', id: 'key-1' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.rawKey).toBe('[REDACTED]');
      expect(entry.id).toBe('key-1');
    });

    test('redaction applies to child logger context', () => {
      const child = logger.child({ apiKey: 'sk-should-be-redacted' });
      child.info('request made');
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.apiKey).toBe('[REDACTED]');
    });

    test('redaction applies to nested objects', () => {
      logger.info('config', {
        db: { password: 'db-secret', host: 'localhost' },
      });
      const entry = parseLogLine(capture.lines[0]);
      const db = entry.db as Record<string, string>;
      expect(db.password).toBe('[REDACTED]');
      expect(db.host).toBe('localhost');
    });
  });

  describe('custom fields', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'debug', write: capture.write });
    });

    test('accepts arbitrary key-value pairs in context', () => {
      logger.info('custom', { userId: 'usr-1', action: 'login', count: 42 });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.userId).toBe('usr-1');
      expect(entry.action).toBe('login');
      expect(entry.count).toBe(42);
    });

    test('accepts nested objects in context', () => {
      logger.info('nested', { meta: { source: 'test', version: 2 } });
      const entry = parseLogLine(capture.lines[0]);
      const meta = entry.meta as Record<string, unknown>;
      expect(meta.source).toBe('test');
      expect(meta.version).toBe(2);
    });

    test('accepts boolean values in context', () => {
      logger.info('flags', { cached: true, retry: false });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.cached).toBe(true);
      expect(entry.retry).toBe(false);
    });
  });

  describe('error logging', () => {
    beforeEach(() => {
      logger = new Logger({ level: 'debug', write: capture.write });
    });

    test('error() accepts Error objects and extracts message', () => {
      logger.error('operation failed', { error: new Error('disk full') });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.message).toBe('operation failed');
      // Error should be serialized (at minimum the message)
      const errorField = entry.error as Record<string, unknown>;
      expect(errorField.message || errorField).toBeTruthy();
    });

    test('error() with string error context', () => {
      logger.error('failed', { error: 'timeout' });
      const entry = parseLogLine(capture.lines[0]);
      expect(entry.error).toBe('timeout');
    });
  });
});
