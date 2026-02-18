import { describe, expect, test } from 'bun:test';
import { jsonResponse } from '../src/middleware.ts';
import { Router } from '../src/router.ts';

function makeReq(method: string, path: string, body?: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    body,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
  });
}

describe('Router', () => {
  test('matches exact path', async () => {
    const router = new Router();
    router.get('/health', () => jsonResponse({ status: 'ok' }));

    const res = await router.handle(makeReq('GET', '/health'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('ok');
  });

  test('matches path with params', async () => {
    const router = new Router();
    router.get('/api/items/:id', (_req, params) => jsonResponse({ id: params.id }));

    const res = await router.handle(makeReq('GET', '/api/items/abc123'));
    const body = await res.json();

    expect(body.data.id).toBe('abc123');
  });

  test('matches multiple params', async () => {
    const router = new Router();
    router.get('/api/:type/:id', (_req, params) => jsonResponse(params));

    const res = await router.handle(makeReq('GET', '/api/users/42'));
    const body = await res.json();

    expect(body.data.type).toBe('users');
    expect(body.data.id).toBe('42');
  });

  test('returns 404 for unmatched path', async () => {
    const router = new Router();
    router.get('/health', () => jsonResponse({ ok: true }));

    const res = await router.handle(makeReq('GET', '/missing'));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('No route');
  });

  test('returns 404 for wrong method', async () => {
    const router = new Router();
    router.get('/health', () => jsonResponse({ ok: true }));

    const res = await router.handle(makeReq('POST', '/health'));
    expect(res.status).toBe(404);
  });

  test('handles OPTIONS preflight', async () => {
    const router = new Router();
    router.get('/health', () => jsonResponse({ ok: true }));

    const res = await router.handle(makeReq('OPTIONS', '/health'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('catches handler errors and returns error response', async () => {
    const router = new Router();
    router.get('/fail', () => {
      throw new Error('handler blew up');
    });

    const res = await router.handle(makeReq('GET', '/fail'));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('handler blew up');
  });

  test('supports all HTTP methods', async () => {
    const router = new Router();
    router.post('/items', () => jsonResponse({ method: 'post' }, 201));
    router.put('/items/:id', () => jsonResponse({ method: 'put' }));
    router.delete('/items/:id', () => jsonResponse({ method: 'delete' }));

    const postRes = await router.handle(makeReq('POST', '/items', '{}'));
    expect(postRes.status).toBe(201);

    const putRes = await router.handle(makeReq('PUT', '/items/1', '{}'));
    expect((await putRes.json()).data.method).toBe('put');

    const delRes = await router.handle(makeReq('DELETE', '/items/1'));
    expect((await delRes.json()).data.method).toBe('delete');
  });

  test('does not match when path has extra segments', async () => {
    const router = new Router();
    router.get('/api/items', () => jsonResponse([]));

    const res = await router.handle(makeReq('GET', '/api/items/extra'));
    expect(res.status).toBe(404);
  });

  test('does not match when path has fewer segments', async () => {
    const router = new Router();
    router.get('/api/items/:id', (_req, params) => jsonResponse(params));

    const res = await router.handle(makeReq('GET', '/api'));
    expect(res.status).toBe(404);
  });
});
