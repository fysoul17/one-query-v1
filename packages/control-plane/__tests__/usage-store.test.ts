import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { UsageStore } from '../src/usage-store.ts';

describe('UsageStore', () => {
  let db: Database;
  let store: UsageStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new UsageStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('records usage', () => {
    store.record({
      apiKeyId: 'key-1',
      endpoint: '/api/agents',
      method: 'GET',
      statusCode: 200,
      timestamp: new Date().toISOString(),
      durationMs: 50,
    });

    const count = store.getRequestCount('key-1', '2000-01-01T00:00:00.000Z');
    expect(count).toBe(1);
  });

  test('counts requests by key and time', () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);

    store.record({
      apiKeyId: 'key-1',
      endpoint: '/api/agents',
      method: 'GET',
      statusCode: 200,
      timestamp: yesterday.toISOString(),
      durationMs: 10,
    });

    store.record({
      apiKeyId: 'key-1',
      endpoint: '/api/agents',
      method: 'GET',
      statusCode: 200,
      timestamp: now.toISOString(),
      durationMs: 10,
    });

    const countAll = store.getRequestCount('key-1', yesterday.toISOString());
    expect(countAll).toBe(2);

    const countToday = store.getRequestCount('key-1', now.toISOString());
    expect(countToday).toBe(1);
  });

  test('gets summaries by period', () => {
    const now = new Date().toISOString();

    store.record({
      apiKeyId: 'key-1',
      endpoint: '/api/agents',
      method: 'GET',
      statusCode: 200,
      timestamp: now,
      durationMs: 10,
    });

    store.record({
      apiKeyId: 'key-2',
      endpoint: '/api/config',
      method: 'GET',
      statusCode: 200,
      timestamp: now,
      durationMs: 20,
    });

    const summaries = store.getSummaries('day');
    expect(summaries.length).toBe(2);
  });

  test('sets and gets quotas', () => {
    store.setQuota({
      apiKeyId: 'key-1',
      maxRequestsPerDay: 100,
      maxRequestsPerMonth: 1000,
      maxAgents: 5,
    });

    const quota = store.getQuota('key-1');
    expect(quota).not.toBeNull();
    expect(quota?.maxRequestsPerDay).toBe(100);
    expect(quota?.maxRequestsPerMonth).toBe(1000);
    expect(quota?.maxAgents).toBe(5);
  });

  test('getQuota returns null for unknown key', () => {
    const quota = store.getQuota('unknown');
    expect(quota).toBeNull();
  });
});
