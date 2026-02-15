import { errorResponse } from '../middleware.ts';

const STUB_RESPONSE = () => errorResponse('Cron manager not implemented yet', 501);

export function createCronRoutes() {
  return {
    list: STUB_RESPONSE,
    create: STUB_RESPONSE,
    update: STUB_RESPONSE,
    remove: STUB_RESPONSE,
  };
}
