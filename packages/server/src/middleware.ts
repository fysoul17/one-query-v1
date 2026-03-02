import type { ApiResponse } from '@autonomy/shared';
import { getErrorDetail } from '@autonomy/shared';
import { ServerError } from './errors.ts';

export function corsHeaders(origin: string = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function handlePreflight(origin: string = '*'): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function jsonResponse<T>(data: T, status = 200, origin: string = '*'): Response {
  const body: ApiResponse<T> = { success: true, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export function errorResponse(error: unknown, status?: number, origin: string = '*'): Response {
  const message = getErrorDetail(error);
  const statusCode = status ?? (error instanceof ServerError ? error.statusCode : 500);
  const body: ApiResponse<never> = { success: false, error: message };
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

const MAX_BODY_SIZE = 1_048_576; // 1 MB

export async function parseJsonBody<T = unknown>(req: Request): Promise<T> {
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    throw new ServerError('Request body too large', 413);
  }

  const text = await req.text();
  if (!text) {
    throw new ServerError('Request body is empty', 400);
  }
  if (text.length > MAX_BODY_SIZE) {
    throw new ServerError('Request body too large', 413);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ServerError('Invalid JSON in request body', 400);
  }
}
