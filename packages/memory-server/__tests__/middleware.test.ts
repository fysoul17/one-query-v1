import { describe, expect, test } from 'bun:test';
import { ServerError } from '../src/errors.ts';
import {
  corsHeaders,
  errorResponse,
  handlePreflight,
  jsonResponse,
  parseJsonBody,
} from '../src/middleware.ts';

describe('corsHeaders', () => {
  test('returns default CORS headers', () => {
    const headers = corsHeaders();
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
  });

  test('overrides origin when provided', () => {
    const headers = corsHeaders('https://example.com');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
  });
});

describe('handlePreflight', () => {
  test('returns 204 with CORS headers', () => {
    const res = handlePreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

describe('jsonResponse', () => {
  test('wraps data in ApiResponse format', async () => {
    const res = jsonResponse({ foo: 'bar' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
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
    const res = jsonResponse('ok');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('errorResponse', () => {
  test('formats Error instance', async () => {
    const res = errorResponse(new Error('something broke'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('something broke');
  });

  test('uses ServerError statusCode', async () => {
    const res = errorResponse(new ServerError('not found', 404));
    expect(res.status).toBe(404);
  });

  test('overrides status when provided', async () => {
    const res = errorResponse(new ServerError('conflict', 409), 422);
    expect(res.status).toBe(422);
  });

  test('handles string errors', async () => {
    const res = errorResponse('raw string error');
    const body = await res.json();
    expect(body.error).toBe('raw string error');
    expect(res.status).toBe(500);
  });

  test('includes CORS headers', () => {
    const res = errorResponse(new Error('fail'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('parseJsonBody', () => {
  test('parses valid JSON body', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
    });
    const result = await parseJsonBody<{ key: string }>(req);
    expect(result.key).toBe('value');
  });

  test('throws on empty body', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: '' });
    await expect(parseJsonBody(req)).rejects.toThrow('Request body is empty');
  });

  test('throws on invalid JSON', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: '{{invalid' });
    await expect(parseJsonBody(req)).rejects.toThrow('Invalid JSON');
  });

  test('throws on body exceeding size limit', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(2_000_000) },
    });
    await expect(parseJsonBody(req)).rejects.toThrow('too large');
  });

  test('throws when actual body exceeds limit', async () => {
    const largeBody = 'a'.repeat(1_048_577);
    const req = new Request('http://localhost', { method: 'POST', body: largeBody });
    await expect(parseJsonBody(req)).rejects.toThrow('too large');
  });
});
