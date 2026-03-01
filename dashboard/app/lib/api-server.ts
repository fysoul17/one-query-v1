import type {
  ActivityEntry,
  AgentRuntimeInfo,
  BackendConfigOption,
  BackendStatusResponse,
  CreateAgentRequest,
  CronEntryWithStatus,
  EnvironmentConfig,
  HealthCheckResponse,
  MemorySearchResult,
  MemoryStats,
  PlatformConfig,
  SessionDetail,
  SessionListResponse,
} from '@autonomy/shared';
import { createFetchApi } from './fetch-api';

const RUNTIME_URL = process.env.RUNTIME_URL ?? 'http://localhost:7820';

const fetchApi = createFetchApi(RUNTIME_URL);

export async function getHealth(): Promise<HealthCheckResponse> {
  return fetchApi<HealthCheckResponse>('/health');
}

export async function getAgents(): Promise<AgentRuntimeInfo[]> {
  return fetchApi<AgentRuntimeInfo[]>('/api/agents');
}

export async function getActivity(limit = 50): Promise<ActivityEntry[]> {
  return fetchApi<ActivityEntry[]>(`/api/activity?limit=${limit}`);
}

export async function getMemoryStats(): Promise<MemoryStats> {
  return fetchApi<MemoryStats>('/api/memory/stats');
}

export async function getConfig(): Promise<PlatformConfig> {
  return fetchApi<PlatformConfig>('/api/config');
}

export async function searchMemory(query: string, limit = 10): Promise<MemorySearchResult> {
  return fetchApi<MemorySearchResult>(
    `/api/memory/search?query=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

export async function createAgent(data: CreateAgentRequest): Promise<AgentRuntimeInfo> {
  return fetchApi<AgentRuntimeInfo>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(id: string): Promise<{ deleted: string }> {
  return fetchApi<{ deleted: string }>(`/api/agents/${id}`, {
    method: 'DELETE',
  });
}

export async function restartAgent(id: string): Promise<AgentRuntimeInfo> {
  return fetchApi<AgentRuntimeInfo>(`/api/agents/${id}/restart`, {
    method: 'POST',
  });
}

export async function getCrons(): Promise<CronEntryWithStatus[]> {
  return fetchApi<CronEntryWithStatus[]>('/api/crons');
}

export async function getRuntimeConfig(): Promise<EnvironmentConfig> {
  return fetchApi<EnvironmentConfig>('/api/config');
}

export async function getBackendStatus(): Promise<BackendStatusResponse> {
  return fetchApi<BackendStatusResponse>('/api/backends/status');
}

export async function getBackendOptions(): Promise<{
  backend: string;
  options: BackendConfigOption[];
}> {
  return fetchApi<{ backend: string; options: BackendConfigOption[] }>('/api/backends/options');
}

// --- Memory Lifecycle (server-side reads) ---

export async function getConsolidationLog(limit = 10): Promise<{ log: unknown[] }> {
  return fetchApi<{ log: unknown[] }>(`/api/memory/consolidation-log?limit=${limit}`);
}

export async function queryAsOf(
  asOf: string,
  options?: { type?: string; agentId?: string; limit?: number },
): Promise<{ entries: unknown[]; totalCount: number }> {
  const params = new URLSearchParams({ asOf });
  if (options?.type) params.set('type', options.type);
  if (options?.agentId) params.set('agentId', options.agentId);
  if (options?.limit) params.set('limit', String(options.limit));
  return fetchApi<{ entries: unknown[]; totalCount: number }>(`/api/memory/query-as-of?${params}`);
}

// --- Sessions ---

export async function getSessions(): Promise<SessionListResponse> {
  return fetchApi<SessionListResponse>('/api/sessions');
}

export async function getSessionDetail(id: string): Promise<SessionDetail> {
  return fetchApi<SessionDetail>(`/api/sessions/${id}`);
}
