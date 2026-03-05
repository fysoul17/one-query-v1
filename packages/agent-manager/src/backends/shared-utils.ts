import type { AIBackend, BackendCapabilities, BackendStatus } from '@autonomy/shared';

/** Mask an API key: show only last 4 chars. Returns undefined for short/missing keys. */
export function maskApiKey(key: string | undefined): string | undefined {
  if (!key || key.length < 12) return undefined;
  return `...${key.slice(-4)}`;
}

/**
 * Build a sanitized env object for spawning child processes.
 * Only forwards explicitly allowed keys from process.env.
 *
 * @param allowedKeys - Env var names to forward
 * @param keyMappings - Optional key remapping (e.g., `{ CODEX_API_KEY: 'OPENAI_API_KEY' }`)
 *                      If the target key isn't set but the source key is, copy the value.
 * @param postProcess - Optional callback for backend-specific env tweaks (e.g., CLAUDE_* forwarding)
 */
export function buildSafeEnv(
  allowedKeys: readonly string[],
  keyMappings?: Record<string, string>,
  postProcess?: (env: Record<string, string>) => void,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of allowedKeys) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (keyMappings) {
    for (const [source, target] of Object.entries(keyMappings)) {
      if (!env[target] && env[source]) {
        env[target] = env[source];
      }
    }
  }
  postProcess?.(env);
  return env;
}

/** Auth timeout for CLI auth checks (ms). */
const AUTH_TIMEOUT_MS = 5000;

/**
 * Check CLI authentication by spawning a command and racing against a timeout.
 *
 * @param command - The CLI command + args (e.g., `['claude', 'auth', 'status', '--json']`)
 * @param env - The sanitized environment to pass to the child process
 * @param parseResult - Optional custom result parser. Receives (exitCode, stdout) and returns boolean.
 *                      Defaults to checking exitCode === 0.
 */
export async function checkCliAuth(
  command: string[],
  env: Record<string, string>,
  parseResult?: (exitCode: number, stdout: string) => boolean,
): Promise<boolean> {
  try {
    const proc = Bun.spawn(command, {
      cwd: process.cwd(),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => {
        timeoutHandle = setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // ignore kill errors
          }
          resolve(1);
        }, AUTH_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timeoutHandle);

    if (parseResult) {
      const stdout = await new Response(proc.stdout as ReadableStream).text();
      return parseResult(exitCode, stdout);
    }

    return exitCode === 0;
  } catch {
    return false;
  }
}

export interface GetStatusOptions {
  /** The backend instance name (e.g., 'claude'). */
  name: AIBackend;
  /** CLI binary name to look up via Bun.which (e.g., 'claude'). */
  cliBinary: string;
  /** Env var names that hold the API key (checked in order). */
  apiKeyEnvVars: string[];
  /** The backend's capabilities object. */
  capabilities: BackendCapabilities;
  /** Function to check CLI auth (only called when CLI is available and no API key). */
  checkAuth: () => Promise<boolean>;
}

/**
 * Build a BackendStatus object following the shared pattern across CLI backends.
 */
export async function getCliBackendStatus(opts: GetStatusOptions): Promise<BackendStatus> {
  const cliPath = typeof Bun !== 'undefined' ? Bun.which(opts.cliBinary) : null;
  const available = cliPath !== null;

  let apiKey: string | undefined;
  for (const envVar of opts.apiKeyEnvVars) {
    apiKey = process.env[envVar];
    if (apiKey) break;
  }
  const hasApiKey = !!apiKey;

  const cliAuthenticated = available && !hasApiKey ? await opts.checkAuth() : false;

  let authMode: BackendStatus['authMode'] = 'none';
  if (hasApiKey) {
    authMode = 'api_key';
  } else if (cliAuthenticated) {
    authMode = 'cli_login';
  }

  const authenticated = hasApiKey || cliAuthenticated;

  return {
    name: opts.name,
    available,
    configured: authenticated,
    authenticated,
    apiKeyMasked: maskApiKey(apiKey),
    authMode,
    capabilities: opts.capabilities,
    error: available ? undefined : `${opts.cliBinary} CLI not found on PATH`,
  };
}
