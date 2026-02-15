import type { Conductor } from '@autonomy/conductor';
import { jsonResponse } from '../middleware.ts';

export function createActivityRoute(conductor: Conductor) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const limit = url.searchParams.has('limit')
      ? parseInt(url.searchParams.get('limit')!, 10)
      : 50;

    const activity = conductor.getActivity(limit);
    return jsonResponse(activity);
  };
}
