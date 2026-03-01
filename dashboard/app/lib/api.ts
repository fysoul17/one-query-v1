import type {
  ActivityEntry,
  AgentRuntimeInfo,
  BackendStatusResponse,
  CreateAgentRequest,
  CreateCronRequest,
  CreateSessionRequest,
  CronEntry,
  CronEntryWithStatus,
  CronExecutionLog,
  EnvironmentConfig,
  HealthCheckResponse,
  MemorySearchResult,
  MemoryStats,
  PlatformConfig,
  RAGStrategy,
  Session,
  SessionDetail,
  SessionListResponse,
  UpdateAgentRequest,
  UpdateCronRequest,
  UpdateSessionRequest,
} from '@autonomy/shared';
import { createFetchApi } from './fetch-api';

const RUNTIME_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_RUNTIME_URL ?? 'http://localhost:7820')
    : 'http://localhost:7820';

const fetchApi = createFetchApi(RUNTIME_URL);

export async function getHealth(): Promise<HealthCheckResponse> {
  return fetchApi<HealthCheckResponse>('/health');
}

export async function getAgents(): Promise<AgentRuntimeInfo[]> {
  return fetchApi<AgentRuntimeInfo[]>('/api/agents');
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

export async function searchMemory(query: string, limit = 10): Promise<MemorySearchResult> {
  return fetchApi<MemorySearchResult>(
    `/api/memory/search?query=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

export async function getMemoryStats(): Promise<MemoryStats> {
  return fetchApi<MemoryStats>('/api/memory/stats');
}

export async function getActivity(limit = 50): Promise<ActivityEntry[]> {
  return fetchApi<ActivityEntry[]>(`/api/activity?limit=${limit}`);
}

export async function getConfig(): Promise<PlatformConfig> {
  return fetchApi<PlatformConfig>('/api/config');
}

export async function getCrons(): Promise<CronEntryWithStatus[]> {
  return fetchApi<CronEntryWithStatus[]>('/api/crons');
}

export async function createCron(data: CreateCronRequest): Promise<CronEntry> {
  return fetchApi<CronEntry>('/api/crons', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCron(id: string, data: UpdateCronRequest): Promise<CronEntry> {
  return fetchApi<CronEntry>(`/api/crons/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteCron(id: string): Promise<{ deleted: string }> {
  return fetchApi<{ deleted: string }>(`/api/crons/${id}`, {
    method: 'DELETE',
  });
}

export async function triggerCron(id: string): Promise<CronExecutionLog> {
  return fetchApi<CronExecutionLog>(`/api/crons/${id}/trigger`, {
    method: 'POST',
  });
}

export async function getCronLogs(cronId?: string, limit?: number): Promise<CronExecutionLog[]> {
  const params = new URLSearchParams();
  if (cronId) params.set('cronId', cronId);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchApi<CronExecutionLog[]>(`/api/crons/logs${qs ? `?${qs}` : ''}`);
}

// Advanced memory API

export async function searchMemoryWithStrategy(
  query: string,
  options?: { limit?: number; strategy?: RAGStrategy; type?: string; agentId?: string },
): Promise<MemorySearchResult> {
  const params = new URLSearchParams({ query });
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.strategy) params.set('strategy', options.strategy);
  if (options?.type) params.set('type', options.type);
  if (options?.agentId) params.set('agentId', options.agentId);
  return fetchApi<MemorySearchResult>(`/api/memory/search?${params}`);
}

export async function deleteMemoryEntry(id: string): Promise<{ deleted: string }> {
  return fetchApi<{ deleted: string }>(`/api/memory/entries/${id}`, {
    method: 'DELETE',
  });
}

// --- Memory Lifecycle Operations ---

export async function forgetMemory(id: string, reason?: string): Promise<{ forgotten: boolean }> {
  return fetchApi(`/api/memory/forget/${id}`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function summarizeSession(sessionId: string): Promise<unknown> {
  return fetchApi(`/api/memory/sessions/${sessionId}/summarize`, {
    method: 'POST',
  });
}

export async function deleteBySource(source: string): Promise<{ deletedCount: number }> {
  return fetchApi(`/api/memory/source/${encodeURIComponent(source)}`, {
    method: 'DELETE',
  });
}

export async function getConsolidationLog(limit = 10): Promise<{ log: unknown[] }> {
  return fetchApi(`/api/memory/consolidation-log?limit=${limit}`);
}

export async function queryAsOf(
  asOf: string,
  options?: { type?: string; agentId?: string; limit?: number },
): Promise<{ entries: unknown[]; totalCount: number }> {
  const params = new URLSearchParams({ asOf });
  if (options?.type) params.set('type', options.type);
  if (options?.agentId) params.set('agentId', options.agentId);
  if (options?.limit) params.set('limit', String(options.limit));
  return fetchApi(`/api/memory/query-as-of?${params}`);
}

// --- Agent Update ---

export async function updateAgent(id: string, data: UpdateAgentRequest): Promise<AgentRuntimeInfo> {
  return fetchApi<AgentRuntimeInfo>(`/api/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Config ---

export async function getRuntimeConfig(): Promise<EnvironmentConfig> {
  return fetchApi<EnvironmentConfig>('/api/config');
}

export async function updateConfig(data: Record<string, unknown>): Promise<EnvironmentConfig> {
  return fetchApi<EnvironmentConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Backends ---

export async function getBackendStatus(): Promise<BackendStatusResponse> {
  return fetchApi<BackendStatusResponse>('/api/backends/status');
}

export async function updateBackendApiKey(
  backendName: string,
  apiKey: string | null,
): Promise<BackendStatusResponse> {
  return fetchApi<BackendStatusResponse>(`/api/backends/${backendName}/api-key`, {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  });
}

export async function logoutBackend(backendName: string): Promise<BackendStatusResponse> {
  return fetchApi<BackendStatusResponse>(`/api/backends/${backendName}/logout`, {
    method: 'POST',
  });
}

// --- Sessions ---

export async function getSessions(options?: {
  agentId?: string;
  page?: number;
  limit?: number;
}): Promise<SessionListResponse> {
  const params = new URLSearchParams();
  if (options?.agentId) params.set('agentId', options.agentId);
  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return fetchApi<SessionListResponse>(`/api/sessions${qs ? `?${qs}` : ''}`);
}

export async function getSession(id: string): Promise<SessionDetail> {
  return fetchApi<SessionDetail>(`/api/sessions/${id}`);
}

export async function createSession(data: CreateSessionRequest): Promise<Session> {
  return fetchApi<Session>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSession(id: string, data: UpdateSessionRequest): Promise<Session> {
  return fetchApi<Session>(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSession(id: string): Promise<{ deleted: string }> {
  return fetchApi<{ deleted: string }>(`/api/sessions/${id}`, {
    method: 'DELETE',
  });
}
