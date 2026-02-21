import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { InstanceStatus } from '@autonomy/shared';
import { InstanceRegistry } from '../src/instance-registry.ts';

describe('InstanceRegistry', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  test('registers and lists instance', () => {
    const registry = new InstanceRegistry(db, {
      heartbeatIntervalMs: 999999,
      staleThresholdMs: 90000,
    });
    registry.register(7820);

    const instances = registry.list();
    expect(instances.length).toBe(1);
    expect(instances[0]?.port).toBe(7820);
    expect(instances[0]?.status).toBe(InstanceStatus.HEALTHY);

    registry.deregister();
  });

  test('deregisters instance', () => {
    const registry = new InstanceRegistry(db, {
      heartbeatIntervalMs: 999999,
      staleThresholdMs: 90000,
    });
    registry.register(7820);
    registry.deregister();

    const instances = registry.list();
    expect(instances.length).toBe(0);
  });

  test('heartbeat updates agent count', () => {
    const registry = new InstanceRegistry(db, {
      heartbeatIntervalMs: 999999,
      staleThresholdMs: 90000,
    });
    registry.register(7820);
    registry.heartbeat(5, 'ok');

    const instances = registry.list();
    expect(instances[0]?.agentCount).toBe(5);
    expect(instances[0]?.memoryStatus).toBe('ok');

    registry.deregister();
  });

  test('marks stale instances as unreachable', async () => {
    const registry = new InstanceRegistry(db, {
      heartbeatIntervalMs: 999999,
      staleThresholdMs: 50,
    });
    registry.register(7820);

    // Wait for stale threshold to pass
    await new Promise((resolve) => setTimeout(resolve, 80));
    const instances = registry.list();
    expect(instances[0]?.status).toBe(InstanceStatus.UNREACHABLE);

    registry.deregister();
  });

  test('multiple instances show up', () => {
    const r1 = new InstanceRegistry(db, { heartbeatIntervalMs: 999999, staleThresholdMs: 90000 });
    const r2 = new InstanceRegistry(db, { heartbeatIntervalMs: 999999, staleThresholdMs: 90000 });

    r1.register(7820);
    r2.register(7821);

    const instances = r1.list();
    expect(instances.length).toBe(2);

    r1.deregister();
    r2.deregister();
  });

  test('remove() deletes another instance by ID', () => {
    const r1 = new InstanceRegistry(db, { heartbeatIntervalMs: 999999, staleThresholdMs: 90000 });
    const r2 = new InstanceRegistry(db, { heartbeatIntervalMs: 999999, staleThresholdMs: 90000 });

    r1.register(7820);
    r2.register(7821);

    // r1 removes r2
    const removed = r1.remove(r2.id);
    expect(removed).toBe(true);

    const instances = r1.list();
    expect(instances.length).toBe(1);
    expect(instances[0]?.port).toBe(7820);

    r1.deregister();
    r2.deregister();
  });

  test('remove() prevents removing self', () => {
    const registry = new InstanceRegistry(db, {
      heartbeatIntervalMs: 999999,
      staleThresholdMs: 90000,
    });
    registry.register(7820);

    const removed = registry.remove(registry.id);
    expect(removed).toBe(false);

    const instances = registry.list();
    expect(instances.length).toBe(1);

    registry.deregister();
  });

  test('remove() returns false for non-existent ID', () => {
    const registry = new InstanceRegistry(db, {
      heartbeatIntervalMs: 999999,
      staleThresholdMs: 90000,
    });
    registry.register(7820);

    const removed = registry.remove('non-existent-id');
    expect(removed).toBe(false);

    registry.deregister();
  });

  test('register() with onHeartbeat callback uses live values', () => {
    let callCount = 0;
    const registry = new InstanceRegistry(db, {
      heartbeatIntervalMs: 50,
      staleThresholdMs: 90000,
    });

    registry.register(7820, '0.0.0', () => {
      callCount++;
      return { agentCount: 3, memoryStatus: 'ok' };
    });

    // Wait for at least one heartbeat tick
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(callCount).toBeGreaterThanOrEqual(1);

        const instances = registry.list();
        expect(instances[0]?.agentCount).toBe(3);
        expect(instances[0]?.memoryStatus).toBe('ok');

        registry.deregister();
        resolve();
      }, 120);
    });
  });
});
