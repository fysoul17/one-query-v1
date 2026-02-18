import type { Database } from 'bun:sqlite';
import type { QuotaConfig, UsageRecord, UsageSummary } from '@autonomy/shared';

interface QuotaRow {
  api_key_id: string;
  max_requests_per_day: number;
  max_requests_per_month: number;
  max_agents: number;
}

export class UsageStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        api_key_id TEXT,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        duration_ms REAL NOT NULL DEFAULT 0,
        metadata TEXT
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_usage_key_id ON usage_records(api_key_id)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_usage_key_timestamp ON usage_records(api_key_id, timestamp)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS quotas (
        api_key_id TEXT PRIMARY KEY,
        max_requests_per_day INTEGER NOT NULL DEFAULT 0,
        max_requests_per_month INTEGER NOT NULL DEFAULT 0,
        max_agents INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  /** Record a usage event (fire-and-forget). */
  record(entry: Omit<UsageRecord, 'id'>): void {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO usage_records (id, api_key_id, endpoint, method, status_code, timestamp, duration_ms, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.apiKeyId,
        entry.endpoint,
        entry.method,
        entry.statusCode,
        entry.timestamp,
        entry.durationMs,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ],
    );
  }

  /** Get request count for a key within a time period. */
  getRequestCount(apiKeyId: string, since: string): number {
    const row = this.db
      .query('SELECT COUNT(*) as count FROM usage_records WHERE api_key_id = ? AND timestamp >= ?')
      .get(apiKeyId, since) as { count: number } | null;
    return row?.count ?? 0;
  }

  /** Get usage summaries grouped by API key for a period. */
  getSummaries(period: 'day' | 'month'): UsageSummary[] {
    const now = new Date();
    let periodStart: Date;

    if (period === 'day') {
      periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const since = periodStart.toISOString();

    const rows = this.db
      .query(`
      SELECT api_key_id, COUNT(*) as request_count
      FROM usage_records
      WHERE timestamp >= ?
      GROUP BY api_key_id
    `)
      .all(since) as { api_key_id: string | null; request_count: number }[];

    return rows.map((r) => ({
      apiKeyId: r.api_key_id,
      apiKeyName: null, // caller can join with auth store
      requestCount: r.request_count,
      period,
      periodStart: since,
    }));
  }

  /** Get quota config for a key. */
  getQuota(apiKeyId: string): QuotaConfig | null {
    const row = this.db
      .query('SELECT * FROM quotas WHERE api_key_id = ?')
      .get(apiKeyId) as QuotaRow | null;
    if (!row) return null;
    return {
      apiKeyId: row.api_key_id,
      maxRequestsPerDay: row.max_requests_per_day,
      maxRequestsPerMonth: row.max_requests_per_month,
      maxAgents: row.max_agents,
    };
  }

  /** Delete usage records older than the given number of days. Returns rows deleted. */
  prune(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const result = this.db.run('DELETE FROM usage_records WHERE timestamp < ?', [cutoff]);
    return result.changes;
  }

  /** Set quota config for a key. */
  setQuota(quota: QuotaConfig): void {
    this.db.run(
      `INSERT OR REPLACE INTO quotas (api_key_id, max_requests_per_day, max_requests_per_month, max_agents)
       VALUES (?, ?, ?, ?)`,
      [quota.apiKeyId, quota.maxRequestsPerDay, quota.maxRequestsPerMonth, quota.maxAgents],
    );
  }
}
