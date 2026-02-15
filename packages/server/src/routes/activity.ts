import type { Conductor } from '@autonomy/conductor';
import { jsonResponse } from '../middleware.ts';

export function createActivityRoute(conductor: Conductor) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam !== null ? parseInt(limitParam, 10) : 50;

    const activity = conductor.getActivity(limit);
    return jsonResponse(activity);
  };
}
