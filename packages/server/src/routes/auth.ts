import type { AuthMiddleware, AuthStore } from '@autonomy/control-plane';
import { getAuthContext } from '@autonomy/control-plane';
import { ApiKeyScope, type CreateApiKeyRequest, type UpdateApiKeyRequest } from '@autonomy/shared';
import { BadRequestError, NotFoundError, ServerError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';

export function createAuthRoutes(store: AuthStore, authMiddleware: AuthMiddleware) {
  function requireScope(req: Request, scope: ApiKeyScope): void {
    const ctx = getAuthContext(req);
    if (!authMiddleware.hasScope(ctx, scope)) {
      throw new ServerError('Insufficient permissions', 403);
    }
  }

  return {
    listKeys: async (req: Request): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const keys = store.list();
      return jsonResponse(keys);
    },

    createKey: async (req: Request): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const body = await parseJsonBody<CreateApiKeyRequest>(req);

      if (!body.name) {
        throw new BadRequestError('name is required');
      }
      if (!body.scopes || body.scopes.length === 0) {
        throw new BadRequestError('scopes is required and must not be empty');
      }

      const validScopes = Object.values(ApiKeyScope) as string[];
      for (const scope of body.scopes) {
        if (!validScopes.includes(scope)) {
          throw new BadRequestError(`Invalid scope "${scope}". Valid: ${validScopes.join(', ')}`);
        }
      }

      const result = store.create(body);
      return jsonResponse(result, 201);
    },

    getKey: async (req: Request, params: RouteParams): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const { id } = params;
      if (!id) throw new BadRequestError('Key id is required');

      const key = store.getById(id);
      if (!key) throw new NotFoundError(`API key "${id}" not found`);

      return jsonResponse(key);
    },

    updateKey: async (req: Request, params: RouteParams): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const { id } = params;
      if (!id) throw new BadRequestError('Key id is required');

      const body = await parseJsonBody<UpdateApiKeyRequest>(req);
      try {
        const updated = store.update(id, body);
        return jsonResponse(updated);
      } catch (error) {
        if ((error as Error).name === 'ApiKeyNotFoundError') {
          throw new NotFoundError((error as Error).message);
        }
        throw error;
      }
    },

    deleteKey: async (req: Request, params: RouteParams): Promise<Response> => {
      requireScope(req, ApiKeyScope.ADMIN);
      const { id } = params;
      if (!id) throw new BadRequestError('Key id is required');

      const deleted = store.delete(id);
      if (!deleted) throw new NotFoundError(`API key "${id}" not found`);

      return jsonResponse({ deleted: id });
    },
  };
}
