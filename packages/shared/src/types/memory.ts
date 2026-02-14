import type { AgentId, Timestamp } from './base.ts';

export const MemoryType = {
  SHORT_TERM: 'short-term',
  LONG_TERM: 'long-term',
} as const;
export type MemoryType = (typeof MemoryType)[keyof typeof MemoryType];

export const RAGStrategy = {
  NAIVE: 'naive',
  GRAPH: 'graph',
  AGENTIC: 'agentic',
} as const;
export type RAGStrategy = (typeof RAGStrategy)[keyof typeof RAGStrategy];

export const VectorProvider = {
  LANCEDB: 'lancedb',
  QDRANT: 'qdrant',
} as const;
export type VectorProvider = (typeof VectorProvider)[keyof typeof VectorProvider];

export interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  agentId?: AgentId;
  sessionId?: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  createdAt: Timestamp;
}

export interface MemorySearchParams {
  query: string;
  type?: MemoryType;
  agentId?: AgentId;
  limit?: number;
  strategy?: RAGStrategy;
}

export interface MemorySearchResult {
  entries: MemoryEntry[];
  totalCount: number;
  strategy: RAGStrategy;
}

export interface MemoryIngestRequest {
  content?: string;
  fileType?: 'pdf' | 'csv' | 'txt';
  metadata?: Record<string, unknown>;
}

export interface MemoryStats {
  totalEntries: number;
  storageUsedBytes: number;
  vectorCount: number;
  recentAccessCount: number;
}

export interface GraphEdge {
  id: string;
  sourceEntity: string;
  targetEntity: string;
  relation: string;
  weight: number;
  memoryEntryId: string;
}
