import type { BackendRegistry } from '@autonomy/agent-manager';
import type { AIBackend, BackendStatusResponse } from '@autonomy/shared';
import { errorResponse, jsonResponse, parseJsonBody } from '../middleware.ts';
import type { SecretStore } from '../secret-store.ts';

/** Minimum length for a valid API key. */
const MIN_API_KEY_LENGTH = 20;
/** Max length to reject obviously bogus values. */
const MAX_API_KEY_LENGTH = 256;

/** Per-backend env var mapping and optional key prefix validation. */
const BACKEND_KEY_CONFIG: Record<string, { envVar: string; altEnvVar?: string; prefix?: RegExp }> =
  {
    claude: { envVar: 'ANTHROPIC_API_KEY', prefix: /^sk-ant-/ },
    codex: { envVar: 'CODEX_API_KEY', altEnvVar: 'OPENAI_API_KEY' },
    gemini: { envVar: 'GEMINI_API_KEY', altEnvVar: 'GOOGLE_API_KEY' },
    pi: { envVar: 'PI_API_KEY' },
    ollama: { envVar: 'OLLAMA_BASE_URL' },
  };

function buildStatusResponse(registry: BackendRegistry): Promise<BackendStatusResponse> {
  return registry.getStatusAll().then((backends) => ({
    defaultBackend: registry.getDefaultName(),
    backends,
  }));
}

/** Validate and set/clear the API key for the given backend config. Returns an error Response or null on success. */
function applyApiKey(
  apiKey: string | null | undefined,
  config: { envVar: string; altEnvVar?: string; prefix?: RegExp },
  secretStore?: SecretStore,
): Response | null {
  if (apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0) {
    const key = apiKey.trim();
    if (key.length < MIN_API_KEY_LENGTH || key.length > MAX_API_KEY_LENGTH) {
      return errorResponse('API key must be between 20 and 256 characters', 400);
    }
    if (config.prefix && !config.prefix.test(key)) {
      return errorResponse(
        `API key must start with "${config.prefix.source.replace('^', '')}"`,
        400,
      );
    }
    process.env[config.envVar] = key;
    secretStore?.set(config.envVar, key);
  } else {
    delete process.env[config.envVar];
    if (config.altEnvVar) {
      delete process.env[config.altEnvVar];
    }
    secretStore?.removeBackendKeys(config.envVar, config.altEnvVar);
  }
  return null;
}

export function createBackendRoutes(registry: BackendRegistry, secretStore?: SecretStore) {
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

    updateApiKey: async (req: Request, backendName?: string): Promise<Response> => {
      try {
        const body = await parseJsonBody<{ apiKey: string | null; backendName?: string }>(req);
        const name = backendName ?? body.backendName ?? 'claude';
        const config = BACKEND_KEY_CONFIG[name];

        if (!config) {
          return errorResponse(
            `Unknown backend: ${name}. API key management is not supported for this backend.`,
            400,
          );
        }

        const validationError = applyApiKey(body.apiKey, config, secretStore);
        if (validationError) return validationError;

        const response = await buildStatusResponse(registry);
        return jsonResponse(response);
      } catch (err) {
        return errorResponse(err);
      }
    },

    logout: async (backendName: string): Promise<Response> => {
      try {
        const name = backendName as AIBackend;
        if (!registry.has(name)) {
          return errorResponse(`Backend "${backendName}" not registered`, 404);
        }

        const backend = registry.get(name);
        if (!backend.logout) {
          return errorResponse('Logout not supported for this backend', 400);
        }

        // Clear persisted API keys regardless of whether logout succeeds
        const keyConfig = BACKEND_KEY_CONFIG[name];
        try {
          await backend.logout();
        } finally {
          if (keyConfig) {
            secretStore?.removeBackendKeys(keyConfig.envVar, keyConfig.altEnvVar);
          }
        }

        const response = await buildStatusResponse(registry);
        return jsonResponse(response);
      } catch (err) {
        return errorResponse(err);
      }
    },
  };
}
