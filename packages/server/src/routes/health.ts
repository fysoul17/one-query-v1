import type { BackendRegistry } from '@autonomy/agent-manager';
import type { Conductor } from '@autonomy/conductor';
import type { BackendStatus, HealthCheckResponse } from '@autonomy/shared';
import type { MemoryInterface } from '@pyx-memory/client';
import { jsonResponse } from '../middleware.ts';

const BACKEND_STATUS_TTL_MS = 30_000;

export function createHealthRoute(
  conductor: Conductor,
  memory: MemoryInterface,
  startTime: number,
  registry?: BackendRegistry,
) {
  let statusCache: { result: BackendStatus[]; expiresAt: number } | null = null;

  async function getCachedBackendStatuses(): Promise<BackendStatus[]> {
    if (statusCache && Date.now() < statusCache.expiresAt) {
      return statusCache.result;
    }
    // Only called inside `if (registry)` guard, so registry is always defined here
    // biome-ignore lint/style/noNonNullAssertion: called inside registry guard
    const result = await registry!.getStatusAll();
    statusCache = { result, expiresAt: Date.now() + BACKEND_STATUS_TTL_MS };
    return result;
  }

  return async (): Promise<Response> => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const agents = conductor.listAgents();

    let memoryStatus = 'ok';
    try {
      const memStats = await memory.stats();
      if (memStats.connected === false) {
        memoryStatus = 'disabled';
      }
    } catch {
      memoryStatus = 'error';
    }

    const status: HealthCheckResponse['status'] = memoryStatus === 'error' ? 'degraded' : 'ok';

    const health: HealthCheckResponse = {
      status,
      uptime,
      agentCount: agents.length,
      memoryStatus,
      version: '0.0.0',
    };

    if (registry) {
      try {
        const statuses = await getCachedBackendStatuses();
        const defaultName = registry.getDefaultName();
        const defaultStatus = statuses.find((s) => s.name === defaultName);

        health.backendStatus = {
          default: defaultName,
          backends: statuses.map((s) => ({
            name: s.name,
            available: s.available,
            authenticated: s.authenticated,
          })),
        };

        if (defaultStatus && !defaultStatus.authenticated) {
          health.status = 'degraded';
        }
      } catch {
        // If status check fails, don't break the health endpoint
      }
    }

    return jsonResponse(health);
  };
}
