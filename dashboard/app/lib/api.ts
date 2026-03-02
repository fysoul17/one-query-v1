import type {
  AgentRuntimeInfo,
  BackendStatusResponse,
  CreateAgentRequest,
  CreateCronRequest,
  CronEntry,
  CronExecutionLog,
  EnvironmentConfig,
  HealthCheckResponse,
  MemoryEntry,
  MemorySearchResult,
  MemoryStats,
  RAGStrategy,
  UpdateAgentRequest,
  UpdateCronRequest,
} from '@autonomy/shared';
import { RUNTIME_URL } from './constants';
import { createFetchApi } from './fetch-api';

const fetchApi = createFetchApi(RUNTIME_URL);

export async function getHealth(): Promise<HealthCheckResponse> {
  return fetchApi<HealthCheckResponse>('/health');
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

export async function getMemoryStats(): Promise<MemoryStats> {
  return fetchApi<MemoryStats>('/api/memory/stats');
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

export async function summarizeSession(sessionId: string): Promise<MemoryEntry | null> {
  return fetchApi(`/api/memory/sessions/${sessionId}/summarize`, {
    method: 'POST',
  });
}

// --- Agent Update ---

export async function updateAgent(id: string, data: UpdateAgentRequest): Promise<AgentRuntimeInfo> {
  return fetchApi<AgentRuntimeInfo>(`/api/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Config ---

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

export async function deleteSession(id: string): Promise<{ deleted: string }> {
  return fetchApi<{ deleted: string }>(`/api/sessions/${id}`, {
    method: 'DELETE',
  });
}
