import { describe, expect, test } from 'bun:test';
import {
  corsHeaders,
  errorResponse,
  handlePreflight,
  jsonResponse,
  parseJsonBody,
} from '../src/middleware.ts';
import { ServerError } from '../src/errors.ts';

describe('corsHeaders', () => {
  test('returns default CORS headers with wildcard origin', () => {
    const headers = corsHeaders();
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
  });

  test('overrides origin when provided', () => {
    const headers = corsHeaders('http://localhost:3000');
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
  });
});

describe('handlePreflight', () => {
  test('returns 204 with CORS headers', () => {
    const res = handlePreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('jsonResponse', () => {
  test('wraps data in ApiResponse with success: true', async () => {
    const res = jsonResponse({ foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ foo: 'bar' });
  });

  test('accepts custom status code', async () => {
    const res = jsonResponse({ id: '123' }, 201);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('includes CORS headers', () => {
    const res = jsonResponse('test');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('errorResponse', () => {
  test('wraps error string in ApiResponse with success: false', async () => {
    const res = errorResponse('something failed', 400);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('something failed');
  });

  test('extracts message from Error instances', async () => {
    const res = errorResponse(new Error('whoops'));
    const body = await res.json();
    expect(body.error).toBe('whoops');
  });

  test('uses statusCode from ServerError', async () => {
    const res = errorResponse(new ServerError('not found', 404));
    expect(res.status).toBe(404);
  });

  test('defaults to 500 for plain errors', () => {
    const res = errorResponse(new Error('crash'));
    expect(res.status).toBe(500);
  });

  test('includes CORS headers', () => {
    const res = errorResponse('err', 500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('parseJsonBody', () => {
  test('parses valid JSON from request body', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });
    const result = await parseJsonBody<{ name: string }>(req);
    expect(result.name).toBe('test');
  });

  test('throws on empty body', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: '' });
    await expect(parseJsonBody(req)).rejects.toThrow('Request body is empty');
  });

  test('throws on invalid JSON', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: '{bad' });
    await expect(parseJsonBody(req)).rejects.toThrow('Invalid JSON');
  });

  test('throws 413 when content-length exceeds limit', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': '2000000' },
    });
    await expect(parseJsonBody(req)).rejects.toThrow('Request body too large');
  });

  test('throws 413 when actual body exceeds limit', async () => {
    const largeBody = JSON.stringify({ data: 'x'.repeat(1_100_000) });
    const req = new Request('http://localhost', { method: 'POST', body: largeBody });
    await expect(parseJsonBody(req)).rejects.toThrow('Request body too large');
  });
});
