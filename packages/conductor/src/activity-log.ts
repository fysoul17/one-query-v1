import crypto from 'node:crypto';
import type { ActivityEntry, ActivityType, AgentId } from '@autonomy/shared';

const DEFAULT_MAX_SIZE = 1000;

export class ActivityLog {
  private entries: ActivityEntry[] = [];
  private maxSize: number;

  constructor(maxSize?: number) {
    this.maxSize = maxSize ?? DEFAULT_MAX_SIZE;
  }

  record(
    type: ActivityType,
    details: string,
    agentId?: AgentId,
    metadata?: Record<string, unknown>,
  ): ActivityEntry {
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      details,
      agentId,
      metadata,
    };

    this.entries.push(entry);

    // Ring buffer: discard oldest when exceeding max size
    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(this.entries.length - this.maxSize);
    }

    return entry;
  }

  getRecent(limit?: number): ActivityEntry[] {
    const l = limit ?? this.maxSize;
    return this.entries.slice(-l).reverse();
  }

  getByAgent(agentId: AgentId, limit?: number): ActivityEntry[] {
    const filtered = this.entries.filter((e) => e.agentId === agentId);
    const l = limit ?? filtered.length;
    return filtered.slice(-l).reverse();
  }

  getByType(type: ActivityType, limit?: number): ActivityEntry[] {
    const filtered = this.entries.filter((e) => e.type === type);
    const l = limit ?? filtered.length;
    return filtered.slice(-l).reverse();
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
