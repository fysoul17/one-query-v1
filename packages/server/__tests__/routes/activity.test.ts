import { describe, expect, test } from 'bun:test';
import { ActivityType } from '@autonomy/shared';
import { MockConductor } from '../helpers/mock-conductor.ts';
import { createActivityRoute } from '../../src/routes/activity.ts';

describe('GET /api/activity', () => {
  test('returns activity entries', async () => {
    const conductor = new MockConductor();
    conductor.addActivity({ type: ActivityType.MESSAGE, details: 'test message' });
    conductor.addActivity({ type: ActivityType.DELEGATION, details: 'delegated to agent' });

    const handler = createActivityRoute(conductor as any);
    const req = new Request('http://localhost/api/activity');
    const res = await handler(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
  });

  test('respects limit parameter', async () => {
    const conductor = new MockConductor();
    for (let i = 0; i < 10; i++) {
      conductor.addActivity({ details: `entry-${i}` });
    }

    const handler = createActivityRoute(conductor as any);
    const req = new Request('http://localhost/api/activity?limit=3');
    const res = await handler(req);
    const body = await res.json();

    expect(body.data.length).toBe(3);
  });

  test('defaults to limit 50', async () => {
    const conductor = new MockConductor();
    const handler = createActivityRoute(conductor as any);
    const req = new Request('http://localhost/api/activity');
    const res = await handler(req);
    const body = await res.json();

    expect(body.success).toBe(true);
  });
});
