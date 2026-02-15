import type { Conductor } from '@autonomy/conductor';
import type { Memory } from '@autonomy/memory';
import type { HealthCheckResponse } from '@autonomy/shared';
import { jsonResponse } from '../middleware.ts';

export function createHealthRoute(conductor: Conductor, memory: Memory, startTime: number) {
  return async (): Promise<Response> => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const agents = conductor.listAgents();

    let memoryStatus = 'ok';
    try {
      await memory.stats();
    } catch {
      memoryStatus = 'error';
    }

    const status = memoryStatus === 'error' ? 'degraded' : 'ok';

    const health: HealthCheckResponse = {
      status,
      uptime,
      agentCount: agents.length,
      memoryStatus,
      version: '0.0.0',
    };

    return jsonResponse(health);
  };
}
