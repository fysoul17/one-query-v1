import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EnvironmentConfig } from '@autonomy/shared';
import { AIBackend } from '@autonomy/shared';

const VALID_AI_BACKENDS = new Set(Object.values(AIBackend));

/** Fields that cannot be updated via the API (security-sensitive). */
const REJECTED_FIELDS = new Set([
  'ANTHROPIC_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'PI_API_KEY',
  'PI_MODEL',
  'QDRANT_URL',
  'MEMORY_URL',
  'AUTH_ENABLED',
  'AUTH_MASTER_KEY',
]);

/** Fields that are valid for runtime updates. */
const UPDATABLE_FIELDS = new Set([
  'AI_BACKEND',
  'MAX_AGENTS',
  'IDLE_TIMEOUT_MS',
  'VECTOR_PROVIDER',
  'LOG_LEVEL',
  'MODE',
]);

export class ConfigManager {
  private config: EnvironmentConfig;
  private overridesPath: string;

  constructor(baseConfig: EnvironmentConfig) {
    this.config = { ...baseConfig };
    this.overridesPath = join(baseConfig.DATA_DIR, 'config.json');
  }

  /** Load persisted overrides from disk and merge into config. */
  initialize(): void {
    if (existsSync(this.overridesPath)) {
      try {
        const raw = readFileSync(this.overridesPath, 'utf-8');
        const overrides = JSON.parse(raw) as Partial<EnvironmentConfig>;
        this.config = { ...this.config, ...overrides };
      } catch {
        // Ignore corrupt file — start fresh
      }
    }
  }

  /** Get the current merged config. */
  get(): EnvironmentConfig {
    return { ...this.config };
  }

  /** Update config fields. Rejects API key / secret updates. Returns updated config. */
  update(updates: Record<string, unknown>): EnvironmentConfig {
    const rejected: string[] = [];
    const applied: Partial<EnvironmentConfig> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (REJECTED_FIELDS.has(key)) {
        rejected.push(key);
        continue;
      }
      if (!UPDATABLE_FIELDS.has(key)) {
        continue; // skip unknown fields silently
      }
      // Validate enum fields
      if (key === 'AI_BACKEND' && (typeof value !== 'string' || !VALID_AI_BACKENDS.has(value))) {
        throw new ConfigUpdateError(
          `Invalid AI_BACKEND: "${String(value)}". Valid: ${[...VALID_AI_BACKENDS].join(', ')}`,
        );
      }
      (applied as Record<string, unknown>)[key] = value;
    }

    if (rejected.length > 0) {
      throw new ConfigUpdateError(`Cannot update sensitive fields: ${rejected.join(', ')}`);
    }

    // Merge into current config
    Object.assign(this.config, applied);

    // Persist overrides
    this.persist(applied);

    return this.get();
  }

  private persist(overrides: Partial<EnvironmentConfig>): void {
    // Load existing persisted overrides and merge
    let existing: Record<string, unknown> = {};
    if (existsSync(this.overridesPath)) {
      try {
        existing = JSON.parse(readFileSync(this.overridesPath, 'utf-8'));
      } catch {
        // ignore
      }
    }

    const merged = { ...existing, ...overrides };

    // Ensure data directory exists
    const dir = this.config.DATA_DIR;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.overridesPath, JSON.stringify(merged, null, 2));
  }
}

export class ConfigUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigUpdateError';
  }
}
