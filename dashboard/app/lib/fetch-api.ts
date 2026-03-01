import type { ApiResponse } from '@autonomy/shared';

export function createFetchApi(baseUrl: string) {
  return async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    };

    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      signal: options?.signal ?? AbortSignal.timeout(10_000),
    });

    const body = (await res.json()) as ApiResponse<T>;

    if (!body.success || body.data === undefined) {
      throw new Error(body.error ?? `API error: ${res.status}`);
    }

    return body.data;
  };
}
