import type {
  ActivityEntry,
  AgentRuntimeInfo,
  BackendConfigOption,
  BackendStatusResponse,
  CronEntryWithStatus,
  EnvironmentConfig,
  HealthCheckResponse,
  MemoryStats,
  SessionDetail,
  SessionListResponse,
} from '@autonomy/shared';
import { SERVER_RUNTIME_URL } from './constants';
import { createFetchApi } from './fetch-api';

const fetchApi = createFetchApi(SERVER_RUNTIME_URL);

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

// --- Sessions ---

export async function getSessions(): Promise<SessionListResponse> {
  return fetchApi<SessionListResponse>('/api/sessions');
}

export async function getSessionDetail(id: string): Promise<SessionDetail> {
  return fetchApi<SessionDetail>(`/api/sessions/${id}`);
}
