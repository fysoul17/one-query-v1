import type { InstanceRegistry } from '@autonomy/control-plane';
import { jsonResponse } from '../middleware.ts';

export function createInstanceRoutes(registry: InstanceRegistry) {
  return {
    list: async (): Promise<Response> => {
      const instances = registry.list();
      return jsonResponse(instances);
    },
  };
}
