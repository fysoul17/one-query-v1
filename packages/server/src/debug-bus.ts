import type { DebugEvent, DebugEventCategory, DebugEventLevel } from '@autonomy/shared';
import { DEBUG_LEVEL_ORDER } from '@autonomy/shared';

export type DebugEventCallback = (event: DebugEvent) => void;

let debugEventCounter = 0;

export function makeDebugEvent(partial: Omit<DebugEvent, 'id' | 'timestamp'>): DebugEvent {
  return {
    id: `dbg-${++debugEventCounter}`,
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

export class DebugBus {
  private readonly ring: (DebugEvent | undefined)[];
  private head = 0;
  private count = 0;
  private readonly maxBuffer: number;
  private subscribers = new Set<DebugEventCallback>();

  constructor(maxBuffer = 500) {
    this.maxBuffer = maxBuffer;
    this.ring = new Array(maxBuffer);
  }

  emit(event: DebugEvent): void {
    this.ring[this.head] = event;
    this.head = (this.head + 1) % this.maxBuffer;
    if (this.count < this.maxBuffer) this.count++;

    for (const cb of this.subscribers) {
      try {
        cb(event);
      } catch (error) {
        // Subscriber errors should not break emission; use console to avoid recursion
        console.warn(
          '[DebugBus] Subscriber threw:',
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  getRecent(
    limit = 100,
    filter?: { categories?: DebugEventCategory[]; minLevel?: DebugEventLevel },
  ): DebugEvent[] {
    const events = this.toArray();
    if (!filter?.categories?.length && !filter?.minLevel) {
      return events.slice(-limit);
    }
    const cats = filter.categories?.length ? new Set(filter.categories) : null;
    const minOrder = filter.minLevel ? DEBUG_LEVEL_ORDER[filter.minLevel] : -1;
    const result: DebugEvent[] = [];
    // Walk from oldest to newest, collect matching, then take last `limit`
    for (const e of events) {
      if (cats && !cats.has(e.category)) continue;
      if (minOrder >= 0 && DEBUG_LEVEL_ORDER[e.level] < minOrder) continue;
      result.push(e);
    }
    return result.slice(-limit);
  }

  subscribe(callback: DebugEventCallback): void {
    this.subscribers.add(callback);
  }

  unsubscribe(callback: DebugEventCallback): void {
    this.subscribers.delete(callback);
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  clear(): void {
    this.ring.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  private toArray(): DebugEvent[] {
    if (this.count === 0) return [];
    if (this.count < this.maxBuffer) {
      // Buffer not full yet — events are at indices [0, count)
      return this.ring.slice(0, this.count) as DebugEvent[];
    }
    // Buffer is full — oldest event is at `head`, wrap around
    const tail = this.ring.slice(this.head) as DebugEvent[];
    const front = this.ring.slice(0, this.head) as DebugEvent[];
    return tail.concat(front);
  }
}
