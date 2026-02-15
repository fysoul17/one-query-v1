import { describe, expect, test } from 'bun:test';
import { Router } from '../src/router.ts';

describe('Router', () => {
  test('matches exact paths', async () => {
    const router = new Router();
    router.get('/health', () => new Response('ok'));

    const res = await router.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('matches nested paths', async () => {
    const router = new Router();
    router.get('/api/agents', () => new Response('agents'));

    const res = await router.handle(new Request('http://localhost/api/agents'));
    expect(await res.text()).toBe('agents');
  });

  test('extracts path params', async () => {
    const router = new Router();
    router.get('/api/agents/:id', (_req, params) => {
      return new Response(params.id);
    });

    const res = await router.handle(new Request('http://localhost/api/agents/abc123'));
    expect(await res.text()).toBe('abc123');
  });

  test('matches correct HTTP method', async () => {
    const router = new Router();
    router.get('/test', () => new Response('GET'));
    router.post('/test', () => new Response('POST'));

    const getRes = await router.handle(new Request('http://localhost/test'));
    expect(await getRes.text()).toBe('GET');

    const postRes = await router.handle(new Request('http://localhost/test', { method: 'POST' }));
    expect(await postRes.text()).toBe('POST');
  });

  test('returns 404 for unmatched routes', async () => {
    const router = new Router();
    router.get('/health', () => new Response('ok'));

    const res = await router.handle(new Request('http://localhost/nonexistent'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('returns 404 for wrong method', async () => {
    const router = new Router();
    router.get('/health', () => new Response('ok'));

    const res = await router.handle(new Request('http://localhost/health', { method: 'POST' }));
    expect(res.status).toBe(404);
  });

  test('handles OPTIONS preflight', async () => {
    const router = new Router();
    const res = await router.handle(new Request('http://localhost/anything', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('catches handler errors and returns error response', async () => {
    const router = new Router();
    router.get('/fail', () => {
      throw new Error('handler crash');
    });

    const res = await router.handle(new Request('http://localhost/fail'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('handler crash');
  });

  test('supports DELETE method', async () => {
    const router = new Router();
    router.delete('/api/agents/:id', (_req, params) => {
      return new Response(`deleted ${params.id}`);
    });

    const res = await router.handle(
      new Request('http://localhost/api/agents/xyz', { method: 'DELETE' }),
    );
    expect(await res.text()).toBe('deleted xyz');
  });

  test('supports PUT method', async () => {
    const router = new Router();
    router.put('/api/config', () => new Response('updated'));

    const res = await router.handle(
      new Request('http://localhost/api/config', { method: 'PUT' }),
    );
    expect(await res.text()).toBe('updated');
  });

  test('does not match partial paths', async () => {
    const router = new Router();
    router.get('/api/agents', () => new Response('agents'));

    const res = await router.handle(new Request('http://localhost/api/agents/extra'));
    expect(res.status).toBe(404);
  });

  test('multiple params in path', async () => {
    const router = new Router();
    router.post('/api/agents/:id/:action', (_req, params) => {
      return new Response(`${params.id}-${params.action}`);
    });

    const res = await router.handle(
      new Request('http://localhost/api/agents/abc/restart', { method: 'POST' }),
    );
    expect(await res.text()).toBe('abc-restart');
  });
});
