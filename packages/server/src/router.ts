import { NotFoundError } from './errors.ts';
import { errorResponse, handlePreflight } from './middleware.ts';

export type RouteParams = Record<string, string>;
export type RouteHandler = (req: Request, params: RouteParams) => Response | Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    const segments = pattern.split('/').filter(Boolean);
    this.routes.push({ method: method.toUpperCase(), segments, handler });
  }

  get(pattern: string, handler: RouteHandler): void {
    this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): void {
    this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: RouteHandler): void {
    this.add('PUT', pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): void {
    this.add('DELETE', pattern, handler);
  }

  async handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return handlePreflight();
    }

    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== req.method) continue;

      const params = matchSegments(route.segments, pathSegments);
      if (params !== null) {
        try {
          return await route.handler(req, params);
        } catch (error) {
          return errorResponse(error);
        }
      }
    }

    return errorResponse(new NotFoundError(`No route for ${req.method} ${url.pathname}`), 404);
  }
}

function matchSegments(pattern: string[], path: string[]): RouteParams | null {
  if (pattern.length !== path.length) return null;

  const params: RouteParams = {};
  for (let i = 0; i < pattern.length; i++) {
    const seg = pattern[i];
    const val = path[i];
    if (seg === undefined || val === undefined) continue;

    if (seg.startsWith(':')) {
      params[seg.slice(1)] = val;
    } else if (seg !== val) {
      return null;
    }
  }
  return params;
}
