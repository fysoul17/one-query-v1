import { beforeEach, describe, expect, test } from 'bun:test';
import type { DebugEvent } from '@autonomy/shared';
import { DebugEventCategory, DebugEventLevel } from '@autonomy/shared';
import { DebugBus, makeDebugEvent } from '../src/debug-bus.ts';

function fakeEvent(overrides: Partial<DebugEvent> = {}): DebugEvent {
  return {
    id: `test-${Date.now()}`,
    timestamp: new Date().toISOString(),
    category: DebugEventCategory.SYSTEM,
    level: DebugEventLevel.INFO,
    source: 'test',
    message: 'test event',
    ...overrides,
  };
}

describe('makeDebugEvent', () => {
  test('generates unique IDs with dbg- prefix', () => {
    const e1 = makeDebugEvent({
      category: DebugEventCategory.SYSTEM,
      level: DebugEventLevel.INFO,
      source: 'test',
      message: 'hello',
    });
    const e2 = makeDebugEvent({
      category: DebugEventCategory.SYSTEM,
      level: DebugEventLevel.INFO,
      source: 'test',
      message: 'world',
    });
    expect(e1.id).toMatch(/^dbg-\d+$/);
    expect(e2.id).toMatch(/^dbg-\d+$/);
    expect(e1.id).not.toBe(e2.id);
  });

  test('sets ISO timestamp', () => {
    const e = makeDebugEvent({
      category: DebugEventCategory.SYSTEM,
      level: DebugEventLevel.INFO,
      source: 'test',
      message: 'hello',
    });
    expect(() => new Date(e.timestamp)).not.toThrow();
    expect(e.timestamp).toContain('T');
  });

  test('preserves provided fields', () => {
    const e = makeDebugEvent({
      category: DebugEventCategory.CONDUCTOR,
      level: DebugEventLevel.ERROR,
      source: 'conductor.test',
      message: 'fail',
      data: { key: 'value' },
      durationMs: 42,
    });
    expect(e.category).toBe('conductor');
    expect(e.level).toBe('error');
    expect(e.source).toBe('conductor.test');
    expect(e.message).toBe('fail');
    expect(e.data).toEqual({ key: 'value' });
    expect(e.durationMs).toBe(42);
  });
});

describe('DebugBus', () => {
  let bus: DebugBus;

  beforeEach(() => {
    bus = new DebugBus(10); // small buffer for testing
  });

  test('emit adds event to buffer', () => {
    const event = fakeEvent();
    bus.emit(event);
    expect(bus.getRecent(10)).toEqual([event]);
  });

  test('emit notifies all subscribers', () => {
    const received: DebugEvent[] = [];
    const received2: DebugEvent[] = [];
    bus.subscribe((e) => received.push(e));
    bus.subscribe((e) => received2.push(e));

    const event = fakeEvent();
    bus.emit(event);

    expect(received).toEqual([event]);
    expect(received2).toEqual([event]);
  });

  test('emit swallows subscriber errors', () => {
    const received: DebugEvent[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => received.push(e));

    const event = fakeEvent();
    bus.emit(event); // should not throw

    expect(received).toEqual([event]);
  });

  test('ring buffer evicts oldest events when full', () => {
    const events: DebugEvent[] = [];
    for (let i = 0; i < 15; i++) {
      const e = fakeEvent({ id: `evt-${i}`, message: `event ${i}` });
      events.push(e);
      bus.emit(e);
    }

    const recent = bus.getRecent(100);
    // Buffer size is 10, so only last 10 events should remain
    expect(recent).toHaveLength(10);
    expect(recent[0].id).toBe('evt-5');
    expect(recent[9].id).toBe('evt-14');
  });

  test('getRecent returns last N events', () => {
    for (let i = 0; i < 8; i++) {
      bus.emit(fakeEvent({ id: `evt-${i}` }));
    }

    const last3 = bus.getRecent(3);
    expect(last3).toHaveLength(3);
    expect(last3[0].id).toBe('evt-5');
    expect(last3[2].id).toBe('evt-7');
  });

  test('getRecent with no filter returns all when under limit', () => {
    bus.emit(fakeEvent({ id: 'a' }));
    bus.emit(fakeEvent({ id: 'b' }));
    expect(bus.getRecent(100)).toHaveLength(2);
  });

  test('getRecent with category filter', () => {
    bus.emit(fakeEvent({ category: DebugEventCategory.CONDUCTOR }));
    bus.emit(fakeEvent({ category: DebugEventCategory.AGENT }));
    bus.emit(fakeEvent({ category: DebugEventCategory.CONDUCTOR }));

    const result = bus.getRecent(100, {
      categories: [DebugEventCategory.CONDUCTOR],
    });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.category === 'conductor')).toBe(true);
  });

  test('getRecent with minLevel filter', () => {
    bus.emit(fakeEvent({ level: DebugEventLevel.DEBUG }));
    bus.emit(fakeEvent({ level: DebugEventLevel.INFO }));
    bus.emit(fakeEvent({ level: DebugEventLevel.WARN }));
    bus.emit(fakeEvent({ level: DebugEventLevel.ERROR }));

    const result = bus.getRecent(100, { minLevel: DebugEventLevel.WARN });
    expect(result).toHaveLength(2);
    expect(result[0].level).toBe('warn');
    expect(result[1].level).toBe('error');
  });

  test('getRecent with combined category + level filter', () => {
    bus.emit(fakeEvent({ category: DebugEventCategory.CONDUCTOR, level: DebugEventLevel.DEBUG }));
    bus.emit(fakeEvent({ category: DebugEventCategory.CONDUCTOR, level: DebugEventLevel.ERROR }));
    bus.emit(fakeEvent({ category: DebugEventCategory.AGENT, level: DebugEventLevel.ERROR }));

    const result = bus.getRecent(100, {
      categories: [DebugEventCategory.CONDUCTOR],
      minLevel: DebugEventLevel.WARN,
    });
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('conductor');
    expect(result[0].level).toBe('error');
  });

  test('subscribe and unsubscribe lifecycle', () => {
    const received: DebugEvent[] = [];
    const cb = (e: DebugEvent) => received.push(e);

    bus.subscribe(cb);
    expect(bus.getSubscriberCount()).toBe(1);

    bus.emit(fakeEvent());
    expect(received).toHaveLength(1);

    bus.unsubscribe(cb);
    expect(bus.getSubscriberCount()).toBe(0);

    bus.emit(fakeEvent());
    expect(received).toHaveLength(1); // not incremented
  });

  test('getSubscriberCount is accurate', () => {
    expect(bus.getSubscriberCount()).toBe(0);
    const cb1 = () => {};
    const cb2 = () => {};
    bus.subscribe(cb1);
    bus.subscribe(cb2);
    expect(bus.getSubscriberCount()).toBe(2);
    bus.unsubscribe(cb1);
    expect(bus.getSubscriberCount()).toBe(1);
  });

  test('clear empties the buffer', () => {
    bus.emit(fakeEvent());
    bus.emit(fakeEvent());
    expect(bus.getRecent(100)).toHaveLength(2);

    bus.clear();
    expect(bus.getRecent(100)).toHaveLength(0);
  });

  test('custom maxBuffer in constructor', () => {
    const smallBus = new DebugBus(3);
    for (let i = 0; i < 5; i++) {
      smallBus.emit(fakeEvent({ id: `e-${i}` }));
    }
    const recent = smallBus.getRecent(100);
    expect(recent).toHaveLength(3);
    expect(recent[0].id).toBe('e-2');
    expect(recent[2].id).toBe('e-4');
  });

  test('events maintain correct order after ring buffer wraps', () => {
    // Fill buffer exactly, then add more
    for (let i = 0; i < 10; i++) {
      bus.emit(fakeEvent({ id: `fill-${i}` }));
    }
    // Now buffer is full, head is at 0 again
    bus.emit(fakeEvent({ id: 'wrap-0' }));
    bus.emit(fakeEvent({ id: 'wrap-1' }));

    const recent = bus.getRecent(100);
    expect(recent).toHaveLength(10);
    // Oldest should be fill-2 (fill-0 and fill-1 evicted)
    expect(recent[0].id).toBe('fill-2');
    expect(recent[8].id).toBe('wrap-0');
    expect(recent[9].id).toBe('wrap-1');
  });

  test('empty bus returns empty array', () => {
    expect(bus.getRecent(100)).toEqual([]);
  });
});
