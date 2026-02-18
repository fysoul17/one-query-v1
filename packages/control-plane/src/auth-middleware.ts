import { timingSafeEqual } from 'node:crypto';
import { type ApiKey, ApiKeyScope } from '@autonomy/shared';
import type { AuthStore } from './auth-store.ts';

export interface AuthContext {
  authenticated: boolean;
  apiKey: ApiKey | null;
  scopes: ApiKeyScope[];
}

const ANONYMOUS_CONTEXT: AuthContext = {
  authenticated: false,
  apiKey: null,
  scopes: [],
};

/** WeakMap to associate auth context with requests. */
const authContextMap = new WeakMap<Request, AuthContext>();

export function setAuthContext(req: Request, ctx: AuthContext): void {
  authContextMap.set(req, ctx);
}

export function getAuthContext(req: Request): AuthContext {
  return authContextMap.get(req) ?? ANONYMOUS_CONTEXT;
}

export interface AuthMiddlewareOptions {
  enabled: boolean;
  masterKey?: string;
  excludedPaths?: string[];
}

export class AuthMiddleware {
  private store: AuthStore;
  private enabled: boolean;
  private masterKey?: string;
  private excludedPaths: Set<string>;

  constructor(store: AuthStore, options: AuthMiddlewareOptions) {
    this.store = store;
    this.enabled = options.enabled;
    this.masterKey = options.masterKey;
    this.excludedPaths = new Set(options.excludedPaths ?? ['/health']);
  }

  /**
   * Authenticate a request. Returns AuthContext on success, or a Response (401/403) on failure.
   * When auth is disabled, all requests pass as anonymous.
   */
  authenticate(req: Request): AuthContext | Response {
    const url = new URL(req.url);

    // Always bypass auth for excluded paths
    if (this.excludedPaths.has(url.pathname)) {
      return ANONYMOUS_CONTEXT;
    }

    // If auth is disabled, pass all requests through as anonymous
    if (!this.enabled) {
      return ANONYMOUS_CONTEXT;
    }

    // Extract bearer token
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    // Also check query param for WebSocket upgrades
    const queryToken = url.searchParams.get('token');
    const rawKey = token ?? queryToken;

    if (!rawKey) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check master key first (constant-time comparison)
    if (this.masterKey && this.timingSafeCompare(rawKey, this.masterKey)) {
      return {
        authenticated: true,
        apiKey: null,
        scopes: Object.values(ApiKeyScope) as ApiKeyScope[],
      };
    }

    // Validate against store
    const apiKey = this.store.validateKey(rawKey);
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return {
      authenticated: true,
      apiKey,
      scopes: apiKey.scopes,
    };
  }

  /** Check if an auth context has the required scope. */
  hasScope(ctx: AuthContext, scope: ApiKeyScope): boolean {
    if (!this.enabled) return true;
    if (!ctx.authenticated) return false;
    return ctx.scopes.includes('admin' as ApiKeyScope) || ctx.scopes.includes(scope);
  }

  /** Constant-time string comparison to prevent timing attacks. */
  private timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
