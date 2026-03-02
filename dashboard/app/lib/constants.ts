const DEFAULT_RUNTIME_URL = 'http://localhost:7820';

/** HTTP base URL for the runtime server (client-side). */
export const RUNTIME_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_RUNTIME_URL ?? DEFAULT_RUNTIME_URL)
    : DEFAULT_RUNTIME_URL;

/** HTTP base URL for the runtime server (server-side RSC). */
export const SERVER_RUNTIME_URL = process.env.RUNTIME_URL ?? DEFAULT_RUNTIME_URL;

/** WebSocket base URL for the runtime server (client-side). */
export const RUNTIME_WS_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_RUNTIME_WS_URL ?? DEFAULT_RUNTIME_URL.replace(/^http/, 'ws'))
    : DEFAULT_RUNTIME_URL.replace(/^http/, 'ws');
