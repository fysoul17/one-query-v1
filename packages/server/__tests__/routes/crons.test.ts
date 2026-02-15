import { describe, expect, test } from 'bun:test';
import { createCronRoutes } from '../../src/routes/crons.ts';

describe('Cron routes (stubs)', () => {
  const routes = createCronRoutes();

  test('list returns 501', async () => {
    const res = routes.list();
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('not implemented');
  });

  test('create returns 501', async () => {
    const res = routes.create();
    expect(res.status).toBe(501);
  });

  test('update returns 501', async () => {
    const res = routes.update();
    expect(res.status).toBe(501);
  });

  test('remove returns 501', async () => {
    const res = routes.remove();
    expect(res.status).toBe(501);
  });
});
