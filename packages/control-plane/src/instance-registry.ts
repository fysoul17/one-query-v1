import type { Database } from 'bun:sqlite';
import { hostname } from 'node:os';
import type { InstanceInfo, InstanceRegistryConfig } from '@autonomy/shared';
import { InstanceStatus } from '@autonomy/shared';

interface InstanceRow {
  id: string;
  hostname: string;
  port: number;
  started_at: string;
  last_heartbeat: string;
  status: string;
  version: string;
  agent_count: number;
  memory_status: string;
}

const DEFAULT_CONFIG: InstanceRegistryConfig = {
  heartbeatIntervalMs: 30_000,
  staleThresholdMs: 90_000,
};

export class InstanceRegistry {
  private db: Database;
  private config: InstanceRegistryConfig;
  private instanceId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database, config?: Partial<InstanceRegistryConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.instanceId = crypto.randomUUID();
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        port INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        last_heartbeat TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'healthy',
        version TEXT NOT NULL DEFAULT '0.0.0',
        agent_count INTEGER NOT NULL DEFAULT 0,
        memory_status TEXT NOT NULL DEFAULT 'unknown'
      )
    `);
  }

  /** Register this instance and start heartbeating. */
  register(port: number, version = '0.0.0'): string {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT OR REPLACE INTO instances (id, hostname, port, started_at, last_heartbeat, status, version, agent_count, memory_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'unknown')`,
      [this.instanceId, hostname(), port, now, now, InstanceStatus.HEALTHY, version],
    );

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, this.config.heartbeatIntervalMs);

    return this.instanceId;
  }

  /** Update heartbeat for this instance. */
  heartbeat(agentCount = 0, memoryStatus = 'ok'): void {
    const now = new Date().toISOString();
    this.db.run(
      'UPDATE instances SET last_heartbeat = ?, agent_count = ?, memory_status = ? WHERE id = ?',
      [now, agentCount, memoryStatus, this.instanceId],
    );
  }

  /** Deregister this instance and stop heartbeating. */
  deregister(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.db.run('DELETE FROM instances WHERE id = ?', [this.instanceId]);
  }

  /** List all instances, marking stale ones as unreachable. */
  list(): InstanceInfo[] {
    this.pruneStale();

    const rows = this.db
      .query('SELECT * FROM instances ORDER BY started_at DESC')
      .all() as InstanceRow[];
    const now = Date.now();

    return rows.map((r) => {
      const lastHb = new Date(r.last_heartbeat).getTime();
      const isStale = now - lastHb > this.config.staleThresholdMs;

      return {
        id: r.id,
        hostname: r.hostname,
        port: r.port,
        startedAt: r.started_at,
        lastHeartbeat: r.last_heartbeat,
        status: isStale ? InstanceStatus.UNREACHABLE : (r.status as InstanceInfo['status']),
        version: r.version,
        agentCount: r.agent_count,
        memoryStatus: r.memory_status,
      };
    });
  }

  /** Remove instances that haven't heartbeated in 3x the stale threshold. */
  private pruneStale(): void {
    const cutoff = new Date(Date.now() - this.config.staleThresholdMs * 3).toISOString();
    this.db.run('DELETE FROM instances WHERE last_heartbeat < ?', [cutoff]);
  }

  get id(): string {
    return this.instanceId;
  }
}
