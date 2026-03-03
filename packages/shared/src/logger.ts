import type { LogLevel } from './types/base.ts';

const LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'cookie',
  'authorization',
  'credential',
  'private_key',
  'key_hash',
  'rawkey',
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return { message: value.message, name: value.name };
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = isSensitiveKey(k) ? '[REDACTED]' : redact(v);
    }
    return result;
  }

  return value;
}

/** Extract a human-readable error message from an unknown caught value. */
export function getErrorDetail(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

interface LoggerConfig {
  level?: LogLevel;
  write?: (line: string) => void;
  context?: Record<string, unknown>;
}

export class Logger {
  private level: number;
  private write: (line: string) => void;
  private baseContext: Record<string, unknown>;

  constructor(config: LoggerConfig = {}) {
    this.level = LEVEL_ORDER[config.level ?? 'info'] ?? 1;
    this.write = config.write ?? ((line: string) => console.log(line));
    this.baseContext = config.context ?? {};
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  child(context: Record<string, unknown>): Logger {
    const childLogger = new Logger({
      write: this.write,
    });
    childLogger.level = this.level;
    childLogger.baseContext = { ...this.baseContext, ...context };
    return childLogger;
  }

  private log(level: string, message: string, context?: Record<string, unknown>): void {
    if ((LEVEL_ORDER[level] ?? 0) < this.level) return;

    const merged = { ...this.baseContext, ...context };
    const redacted = redact(merged) as Record<string, unknown>;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...redacted,
    };

    this.write(JSON.stringify(entry));
  }
}
