import type {
  ActivityEntry,
  AgentRuntimeInfo,
  ApiKey,
  ApiResponse,
  BackendConfigOption,
  BackendStatusResponse,
  CreateAgentRequest,
  CronEntryWithStatus,
  EnvironmentConfig,
  GraphNode,
  HealthCheckResponse,
  InstanceInfo,
  MemoryEntry,
  MemorySearchResult,
  MemoryStats,
  PlatformConfig,
  SessionDetail,
  SessionListResponse,
  UsageSummary,
} from '@autonomy/shared';

const RUNTIME_URL = process.env.RUNTIME_URL ?? 'http://localhost:7820';
const RUNTIME_API_KEY = process.env.RUNTIME_API_KEY ?? '';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (RUNTIME_API_KEY) {
    headers.Authorization = `Bearer ${RUNTIME_API_KEY}`;
  }

  const res = await fetch(`${RUNTIME_URL}${path}`, {
    ...options,
    headers,
  });

  const body = (await res.json()) as ApiResponse<T>;

  if (!body.success || body.data === undefined) {
    throw new Error(body.error ?? `API error: ${res.status}`);
  }

  return body.data;
}

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

// Memory server API (uses MEMORY_URL if set, falls back to RUNTIME_URL)
const MEMORY_URL = process.env.MEMORY_URL;

async function fetchMemoryApi<T>(path: string, options?: RequestInit): Promise<T> {
  if (MEMORY_URL) {
    const res = await fetch(`${MEMORY_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    const body = (await res.json()) as ApiResponse<T>;
    if (!body.success || body.data === undefined) {
      throw new Error(body.error ?? `Memory API error: ${res.status}`);
    }
    return body.data;
  }
  return fetchApi<T>(path, options);
}

export async function getMemoryEntries(
  page = 1,
  limit = 20,
  query?: string,
): Promise<{ entries: MemoryEntry[]; page: number; limit: number; totalCount: number }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (query) params.set('query', query);
  return fetchMemoryApi(`/api/memory/entries?${params}`);
}

export async function getGraphNodes(options?: {
  name?: string;
  type?: string;
  limit?: number;
}): Promise<{ nodes: GraphNode[]; totalCount: number }> {
  const params = new URLSearchParams();
  if (options?.name) params.set('name', options.name);
  if (options?.type) params.set('type', options.type);
  if (options?.limit) params.set('limit', String(options.limit));
  return fetchMemoryApi(`/api/memory/graph/nodes?${params}`);
}

export async function getGraphEdges(): Promise<{
  stats: { nodeCount: number; edgeCount: number };
}> {
  return fetchMemoryApi('/api/memory/graph/edges');
}

// --- Control Plane Server APIs ---

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

export async function getApiKeys(): Promise<ApiKey[]> {
  return fetchApi<ApiKey[]>('/api/auth/keys');
}

export async function getUsageSummary(period: 'day' | 'month' = 'day'): Promise<UsageSummary[]> {
  return fetchApi<UsageSummary[]>(`/api/usage/summary?period=${period}`);
}

export async function getInstances(): Promise<InstanceInfo[]> {
  return fetchApi<InstanceInfo[]>('/api/instances');
}

// --- Sessions ---

export async function getSessions(): Promise<SessionListResponse> {
  return fetchApi<SessionListResponse>('/api/sessions');
}

export async function getSessionDetail(id: string): Promise<SessionDetail> {
  return fetchApi<SessionDetail>(`/api/sessions/${id}`);
}
