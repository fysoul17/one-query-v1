import type { ConfigManager, ConfigUpdateError } from '../config-manager.ts';
import { BadRequestError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';

export function createConfigRoutes(configManager: ConfigManager) {
  return {
    get: async (): Promise<Response> => {
      const config = configManager.get();
      const redacted = {
        ...config,
        ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY ? '***' : undefined,
      };
      return jsonResponse(redacted);
    },

    update: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<Record<string, unknown>>(req);

      try {
        const updated = configManager.update(body);
        const redacted = {
          ...updated,
          ANTHROPIC_API_KEY: updated.ANTHROPIC_API_KEY ? '***' : undefined,
        };
        return jsonResponse(redacted);
      } catch (error) {
        if ((error as ConfigUpdateError).name === 'ConfigUpdateError') {
          throw new BadRequestError((error as Error).message);
        }
        throw error;
      }
    },
  };
}
