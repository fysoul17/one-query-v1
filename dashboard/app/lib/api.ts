import type {
  ActivityEntry,
  AgentRuntimeInfo,
  ApiKey,
  ApiResponse,
  CreateAgentRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateCronRequest,
  CronEntry,
  CronExecutionLog,
  EnvironmentConfig,
  GraphNode,
  GraphTraversalResult,
  HealthCheckResponse,
  InstanceInfo,
  MemoryEntry,
  MemoryIngestRequest,
  MemorySearchResult,
  MemoryStats,
  PlatformConfig,
  QuotaConfig,
  RAGStrategy,
  UpdateAgentRequest,
  UpdateApiKeyRequest,
  UpdateCronRequest,
  UsageSummary,
} from '@autonomy/shared';

const RUNTIME_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_RUNTIME_URL ?? 'http://localhost:7820')
    : 'http://localhost:7820';

const RUNTIME_API_KEY =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_RUNTIME_API_KEY ?? '')
    : '';

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

export async function ingestMemory(data: MemoryIngestRequest): Promise<unknown> {
  return fetchApi<unknown>('/api/memory/ingest', {
    method: 'POST',
    body: JSON.stringify(data),
  });
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

export async function getCrons(): Promise<CronEntry[]> {
  return fetchApi<CronEntry[]>('/api/crons');
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

export async function getGraphData(): Promise<{
  nodes: GraphNode[];
  totalCount: number;
}> {
  return fetchApi(`/api/memory/graph/nodes`);
}

export async function queryGraph(
  nodeId: string,
  depth = 1,
): Promise<GraphTraversalResult> {
  return fetchApi<GraphTraversalResult>('/api/memory/graph/query', {
    method: 'POST',
    body: JSON.stringify({ nodeId, depth }),
  });
}

export async function uploadFile(file: File): Promise<unknown> {
  const formData = new FormData();
  formData.append('file', file);

  const headers: Record<string, string> = {};
  if (RUNTIME_API_KEY) {
    headers.Authorization = `Bearer ${RUNTIME_API_KEY}`;
  }

  const res = await fetch(`${RUNTIME_URL}/api/memory/ingest/file`, {
    method: 'POST',
    body: formData,
    headers,
  });

  const body = (await res.json()) as ApiResponse<unknown>;
  if (!body.success || body.data === undefined) {
    throw new Error(body.error ?? `API error: ${res.status}`);
  }
  return body.data;
}

// --- Agent Update ---

export async function updateAgent(
  id: string,
  data: UpdateAgentRequest,
): Promise<AgentRuntimeInfo> {
  return fetchApi<AgentRuntimeInfo>(`/api/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Config ---

export async function getRuntimeConfig(): Promise<EnvironmentConfig> {
  return fetchApi<EnvironmentConfig>('/api/config');
}

export async function updateConfig(
  data: Record<string, unknown>,
): Promise<EnvironmentConfig> {
  return fetchApi<EnvironmentConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- API Keys ---

export async function getApiKeys(): Promise<ApiKey[]> {
  return fetchApi<ApiKey[]>('/api/auth/keys');
}

export async function createApiKey(
  data: CreateApiKeyRequest,
): Promise<CreateApiKeyResponse> {
  return fetchApi<CreateApiKeyResponse>('/api/auth/keys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateApiKey(
  id: string,
  data: UpdateApiKeyRequest,
): Promise<ApiKey> {
  return fetchApi<ApiKey>(`/api/auth/keys/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteApiKey(id: string): Promise<{ deleted: string }> {
  return fetchApi<{ deleted: string }>(`/api/auth/keys/${id}`, {
    method: 'DELETE',
  });
}

// --- Usage ---

export async function getUsageSummary(
  period: 'day' | 'month' = 'day',
): Promise<UsageSummary[]> {
  return fetchApi<UsageSummary[]>(`/api/usage/summary?period=${period}`);
}

export async function getQuota(keyId: string): Promise<QuotaConfig | null> {
  return fetchApi<QuotaConfig | null>(`/api/usage/quotas/${keyId}`);
}

export async function setQuota(
  keyId: string,
  data: Omit<QuotaConfig, 'apiKeyId'>,
): Promise<QuotaConfig> {
  return fetchApi<QuotaConfig>(`/api/usage/quotas/${keyId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// --- Instances ---

export async function getInstances(): Promise<InstanceInfo[]> {
  return fetchApi<InstanceInfo[]>('/api/instances');
}
