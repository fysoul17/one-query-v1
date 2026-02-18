import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ApiKeyScope } from '@autonomy/shared';
import { type AuthContext, AuthMiddleware } from '../src/auth-middleware.ts';
import { AuthStore } from '../src/auth-store.ts';

describe('AuthMiddleware', () => {
  let db: Database;
  let store: AuthStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new AuthStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('passes all requests when disabled', () => {
    const mw = new AuthMiddleware(store, { enabled: false });
    const req = new Request('http://localhost/api/agents');
    const result = mw.authenticate(req);

    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as AuthContext;
    expect(ctx.authenticated).toBe(false);
  });

  test('excludes /health from auth', () => {
    const mw = new AuthMiddleware(store, { enabled: true });
    const req = new Request('http://localhost/health');
    const result = mw.authenticate(req);

    expect(result).not.toBeInstanceOf(Response);
  });

  test('returns 401 when enabled and no token', () => {
    const mw = new AuthMiddleware(store, { enabled: true });
    const req = new Request('http://localhost/api/agents');
    const result = mw.authenticate(req);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  test('authenticates with valid bearer token', () => {
    const { rawKey } = store.create({
      name: 'Test',
      scopes: [ApiKeyScope.READ, ApiKeyScope.AGENTS],
    });

    const mw = new AuthMiddleware(store, { enabled: true });
    const req = new Request('http://localhost/api/agents', {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    const result = mw.authenticate(req);

    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as AuthContext;
    expect(ctx.authenticated).toBe(true);
    expect(ctx.apiKey).not.toBeNull();
    expect(ctx.scopes).toContain(ApiKeyScope.READ);
  });

  test('authenticates with query token (WebSocket)', () => {
    const { rawKey } = store.create({
      name: 'WS Key',
      scopes: [ApiKeyScope.READ],
    });

    const mw = new AuthMiddleware(store, { enabled: true });
    const req = new Request(`http://localhost/ws/chat?token=${rawKey}`);
    const result = mw.authenticate(req);

    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as AuthContext;
    expect(ctx.authenticated).toBe(true);
  });

  test('authenticates with master key', () => {
    const mw = new AuthMiddleware(store, {
      enabled: true,
      masterKey: 'master-secret-key',
    });

    const req = new Request('http://localhost/api/agents', {
      headers: { Authorization: 'Bearer master-secret-key' },
    });
    const result = mw.authenticate(req);

    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as AuthContext;
    expect(ctx.authenticated).toBe(true);
    expect(ctx.scopes).toContain('admin');
  });

  test('returns 401 for invalid key', () => {
    const mw = new AuthMiddleware(store, { enabled: true });
    const req = new Request('http://localhost/api/agents', {
      headers: { Authorization: 'Bearer ak_invalid_key_value' },
    });
    const result = mw.authenticate(req);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  test('hasScope returns true when disabled', () => {
    const mw = new AuthMiddleware(store, { enabled: false });
    const ctx: AuthContext = { authenticated: false, apiKey: null, scopes: [] };
    expect(mw.hasScope(ctx, ApiKeyScope.ADMIN)).toBe(true);
  });

  test('hasScope checks admin scope', () => {
    const mw = new AuthMiddleware(store, { enabled: true });
    const ctx: AuthContext = {
      authenticated: true,
      apiKey: null,
      scopes: [ApiKeyScope.ADMIN],
    };
    expect(mw.hasScope(ctx, ApiKeyScope.AGENTS)).toBe(true);
  });

  test('hasScope rejects missing scope', () => {
    const mw = new AuthMiddleware(store, { enabled: true });
    const ctx: AuthContext = {
      authenticated: true,
      apiKey: null,
      scopes: [ApiKeyScope.READ],
    };
    expect(mw.hasScope(ctx, ApiKeyScope.ADMIN)).toBe(false);
  });
});
