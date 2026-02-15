import type { EnvironmentConfig } from '@autonomy/shared';
import { errorResponse, jsonResponse } from '../middleware.ts';

export function createConfigRoutes(config: EnvironmentConfig) {
  return {
    get: async (): Promise<Response> => {
      const redacted = {
        ...config,
        ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY ? '***' : undefined,
      };
      return jsonResponse(redacted);
    },

    update: async (): Promise<Response> => {
      return errorResponse('Config update not implemented yet', 501);
    },
  };
}
