import type { BackendRegistry } from '@autonomy/agent-manager';
import { AIBackend, type BackendStatusResponse } from '@autonomy/shared';
import { errorResponse, jsonResponse, parseJsonBody } from '../middleware.ts';

/** Minimum length for a valid Anthropic API key. */
const MIN_API_KEY_LENGTH = 20;
/** Max length to reject obviously bogus values. */
const MAX_API_KEY_LENGTH = 256;
/** Pattern for valid Anthropic API key prefixes. */
const API_KEY_PREFIX = /^sk-ant-/;

function buildStatusResponse(registry: BackendRegistry): Promise<BackendStatusResponse> {
  return registry.getStatusAll().then((backends) => ({
    defaultBackend: registry.getDefaultName(),
    backends,
  }));
}

export function createBackendRoutes(registry: BackendRegistry) {
  return {
    status: async (): Promise<Response> => {
      const response = await buildStatusResponse(registry);
      return jsonResponse(response);
    },

    options: (): Response => {
      try {
        const backend = registry.getDefault();
        const options = backend.getConfigOptions();
        return jsonResponse({ backend: backend.name, options });
      } catch (err) {
        return errorResponse(err);
      }
    },

    updateApiKey: async (req: Request): Promise<Response> => {
      try {
        const body = await parseJsonBody<{ apiKey: string | null }>(req);

        if (body.apiKey && typeof body.apiKey === 'string' && body.apiKey.trim().length > 0) {
          const key = body.apiKey.trim();
          if (key.length < MIN_API_KEY_LENGTH || key.length > MAX_API_KEY_LENGTH) {
            return errorResponse('API key must be between 20 and 256 characters', 400);
          }
          if (!API_KEY_PREFIX.test(key)) {
            return errorResponse('API key must start with "sk-ant-"', 400);
          }
          process.env.ANTHROPIC_API_KEY = key;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }

        const response = await buildStatusResponse(registry);
        return jsonResponse(response);
      } catch (err) {
        return errorResponse(err);
      }
    },

    claudeLogout: async (): Promise<Response> => {
      try {
        if (!registry.has(AIBackend.CLAUDE)) {
          return errorResponse('Claude backend not registered', 404);
        }

        const backend = registry.get(AIBackend.CLAUDE);
        if (!backend.logout) {
          return errorResponse('Logout not supported for this backend', 400);
        }

        await backend.logout();

        const response = await buildStatusResponse(registry);
        return jsonResponse(response);
      } catch (err) {
        return errorResponse(err);
      }
    },
  };
}
