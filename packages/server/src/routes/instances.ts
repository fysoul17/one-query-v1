import type { InstanceRegistry } from '@autonomy/control-plane';
import { BadRequestError, NotFoundError } from '../errors.ts';
import { errorResponse, jsonResponse } from '../middleware.ts';
import type { RouteParams } from '../router.ts';

export function createInstanceRoutes(registry: InstanceRegistry) {
  return {
    list: async (): Promise<Response> => {
      const instances = registry.list();
      return jsonResponse(instances);
    },

    remove: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) return errorResponse(new BadRequestError('Missing instance ID'), 400);

      const removed = registry.remove(id);
      if (!removed) {
        return errorResponse(
          new NotFoundError('Instance not found or cannot remove active instance'),
          404,
        );
      }

      return jsonResponse({ deleted: id });
    },
  };
}
