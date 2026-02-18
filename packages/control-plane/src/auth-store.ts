import type { Database } from 'bun:sqlite';
import type {
  ApiKey,
  ApiKeyScope,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  UpdateApiKeyRequest,
} from '@autonomy/shared';
import { ApiKeyNotFoundError } from './errors.ts';

const KEY_PREFIX = 'ak_';
const KEY_LENGTH = 48;
const PREFIX_LENGTH = 8;

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  rate_limit: number;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  enabled: number;
}

export class AuthStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        rate_limit INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);
  }

  /** Create a new API key. Returns the raw key only on creation. */
  create(request: CreateApiKeyRequest): CreateApiKeyResponse {
    const id = crypto.randomUUID();
    const rawKey = this.generateKey();
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, KEY_PREFIX.length + PREFIX_LENGTH);

    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO api_keys (id, name, key_hash, key_prefix, scopes, rate_limit, created_at, expires_at, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        request.name,
        keyHash,
        keyPrefix,
        JSON.stringify(request.scopes),
        request.rateLimit ?? 0,
        now,
        request.expiresAt ?? null,
      ],
    );

    return {
      key: this.rowToApiKey({
        id,
        name: request.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: JSON.stringify(request.scopes),
        rate_limit: request.rateLimit ?? 0,
        created_at: now,
        expires_at: request.expiresAt ?? null,
        last_used_at: null,
        enabled: 1,
      }),
      rawKey,
    };
  }

  /** List all API keys (never includes raw key or hash). */
  list(): ApiKey[] {
    const rows = this.db
      .query('SELECT * FROM api_keys ORDER BY created_at DESC')
      .all() as ApiKeyRow[];
    return rows.map((r) => this.rowToApiKey(r));
  }

  /** Get a single API key by ID. */
  getById(id: string): ApiKey | null {
    const row = this.db.query('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKeyRow | null;
    return row ? this.rowToApiKey(row) : null;
  }

  /** Look up a key by its raw value (hashes and compares). */
  validateKey(rawKey: string): ApiKey | null {
    const hash = this.hashKey(rawKey);
    const row = this.db
      .query('SELECT * FROM api_keys WHERE key_hash = ?')
      .get(hash) as ApiKeyRow | null;
    if (!row) return null;

    const key = this.rowToApiKey(row);

    // Check if enabled
    if (!key.enabled) return null;

    // Check expiry
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return null;

    // Update last_used_at asynchronously to avoid blocking the hot path
    const keyId = key.id;
    const now = new Date().toISOString();
    queueMicrotask(() => {
      try {
        this.db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, keyId]);
      } catch {
        // Fire-and-forget — don't block auth
      }
    });

    return key;
  }

  /** Update an existing API key. */
  update(id: string, updates: UpdateApiKeyRequest): ApiKey {
    const existing = this.getById(id);
    if (!existing) throw new ApiKeyNotFoundError(id);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.scopes !== undefined) {
      sets.push('scopes = ?');
      values.push(JSON.stringify(updates.scopes));
    }
    if (updates.rateLimit !== undefined) {
      sets.push('rate_limit = ?');
      values.push(updates.rateLimit);
    }
    if (updates.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }

    if (sets.length > 0) {
      values.push(id);
      this.db.run(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = ?`, values);
    }

    // Safe: we validated existence at the top of this method
    return this.getById(id) as ApiKey;
  }

  /** Delete an API key. */
  delete(id: string): boolean {
    const existing = this.getById(id);
    if (!existing) return false;
    this.db.run('DELETE FROM api_keys WHERE id = ?', [id]);
    return true;
  }

  private generateKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const limit = 256 - (256 % chars.length); // 248 — reject bytes >= this to eliminate modulo bias
    let key = KEY_PREFIX;
    while (key.length < KEY_PREFIX.length + KEY_LENGTH) {
      const bytes = new Uint8Array(KEY_LENGTH); // over-allocate to avoid multiple rounds
      crypto.getRandomValues(bytes);
      for (const byte of bytes) {
        if (byte < limit && key.length < KEY_PREFIX.length + KEY_LENGTH) {
          key += chars[byte % chars.length];
        }
      }
    }
    return key;
  }

  private hashKey(rawKey: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(rawKey);
    return hasher.digest('hex');
  }

  private rowToApiKey(row: ApiKeyRow): ApiKey {
    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      scopes: JSON.parse(row.scopes) as ApiKeyScope[],
      rateLimit: row.rate_limit,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      lastUsedAt: row.last_used_at ?? undefined,
      enabled: row.enabled === 1,
    };
  }
}
