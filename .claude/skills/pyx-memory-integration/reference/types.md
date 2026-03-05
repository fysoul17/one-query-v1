# pyx-memory Type Reference

## Contents
- Type Cheat Sheet
- MemoryInterface (9 methods)
- ExtendedMemoryInterface (6 lifecycle methods)
- MemoryClient Constructor and Concrete Methods
- DashboardClient
- MemorySearchResult, MemoryEntry, MemorySearchParams
- MemoryOptions Reference
- Embedding Dimension Defaults

## Type Cheat Sheet

| Type | Signature | Import From |
|------|-----------|-------------|
| `LLMCallback` | `(prompt: string) => Promise<string>` | `@pyx-memory/core` |
| `ReasoningProvider` | `(prompt: string) => Promise<string>` | `@pyx-memory/core` |
| `StoreInput` | `Omit<MemoryEntry, 'id' \| 'createdAt'> & { targets?, entities?, relationships? }` | `@pyx-memory/core` |
| `MemoryType` | `'short-term' \| 'long-term' \| 'working' \| 'episodic' \| 'summary'` | `@pyx-memory/shared` |
| `RAGStrategy` | `'naive' \| 'graph' \| 'agentic' \| 'hybrid'` | `@pyx-memory/shared` |
| `VectorProvider` | `'lancedb'` | `@pyx-memory/shared` |
| `StoreTarget` | `'sqlite' \| 'vector' \| 'graph'` | `@pyx-memory/shared` |
| `IngestEntity` | `{ name, type, properties? }` | `@pyx-memory/shared` |
| `IngestRelationship` | `{ source, target, type, properties? }` | `@pyx-memory/shared` |
| `EntityType` | `'PERSON' \| 'ORGANIZATION' \| 'CONCEPT' \| 'TOOL' \| 'LOCATION' \| 'EVENT'` | `@pyx-memory/core` |
| `RelationType` | `'USES' \| 'OWNS' \| 'DEPENDS_ON' \| 'RELATED_TO' \| 'CREATED_BY' \| 'PART_OF' \| 'IS_A' \| 'WORKS_AT' \| 'LOCATED_IN'` | `@pyx-memory/core` |
| `MemoryListParams` | `{ page?, limit?, type?, agentId? }` | `@pyx-memory/client` |
| `MemoryListResult` | `{ entries, totalCount, page, limit }` | `@pyx-memory/client` |
| `IngestionResult` | `{ filename, chunks, totalCharacters }` | `@pyx-memory/client` |
| `MemoryServerError` | `Error` with `.status` and `.isNotFound` | `@pyx-memory/client` |
| `GraphNode` | `{ id, name, type, properties, memoryEntryIds }` | `@pyx-memory/shared` |
| `GraphTraversalResult` | `{ nodes, relationships, paths }` | `@pyx-memory/shared` |

---

## MemoryInterface (9 methods)

```typescript
interface MemoryInterface {
  initialize(): Promise<void>;
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string; targets?: StoreTarget[]; entities?: IngestEntity[]; relationships?: IngestRelationship[] }): Promise<MemoryEntry>;
  search(params: MemorySearchParams): Promise<MemorySearchResult>;
  list(params?: MemoryListParams): Promise<MemoryListResult>;  // paginated entry listing
  get(id: string): Promise<MemoryEntry | null>;
  delete(id: string): Promise<boolean>;
  clearSession(sessionId: string): Promise<number>;
  stats(): Promise<MemoryStats>;
  shutdown(): Promise<void>;
}
```

## ExtendedMemoryInterface (adds 6 lifecycle methods)

```typescript
interface ExtendedMemoryInterface extends MemoryInterface {
  consolidate(): Promise<ConsolidationRunResult>;
  forget(id: string, reason?: string): Promise<boolean>;
  summarizeSession(sessionId: string): Promise<MemoryEntry | null>;
  runDecay(): Promise<number>;
  reindex(): Promise<void>;
  deleteBySource(source: string): Promise<number>;
}
```

## MemoryClient Constructor and Concrete Methods

```typescript
// Constructor: URL required, apiKey optional
const client = new MemoryClient('http://localhost:7822');                    // no auth
const client = new MemoryClient('http://localhost:7822', 'my-api-key');     // with auth
const client = new MemoryClient('http://localhost:7822', process.env.MEMORY_API_KEY); // from env
```

When `apiKey` is provided, all requests include `Authorization: Bearer <key>`. Empty or whitespace-only keys are ignored.

`MemoryClient` implements `ExtendedMemoryInterface` AND has additional methods not on any interface.
Graph queries and file ingestion are available without `@pyx-memory/core`.

```typescript
class MemoryClient implements ExtendedMemoryInterface {
  // ... all 15 interface methods (9 base + 6 lifecycle) ...

  // Graph operations (call pyx-memory server's graph endpoints)
  graphNodes(): Promise<GraphNode[]>;
  graphEdges(): Promise<{ stats: { nodeCount: number; edgeCount: number } }>;
  graphQuery(query: { nodeId: string; depth?: number }): Promise<GraphTraversalResult>;

  // File ingestion (multipart upload to server)
  ingestFile(file: File): Promise<IngestionResult>;

  // Bi-temporal queries
  queryAsOf(asOf: string, filters?: TemporalQueryFilters): Promise<MemoryEntry[]>;
  queryByEventTime(startTime: string, endTime: string, filters?: TemporalQueryFilters): Promise<MemoryEntry[]>;
}
```

**Key insight for consumers**: You do NOT need `@pyx-memory/core` for graph queries or file ingestion.
`MemoryClient` already proxies these through the HTTP API.

## DashboardClient (extends MemoryClient)

`DashboardClient` from `@pyx-memory/dashboard` adds dashboard-specific methods:

```typescript
import { DashboardClient } from '@pyx-memory/dashboard';

class DashboardClient extends MemoryClient {
  consolidationLog(limit?: number): Promise<ConsolidationLogEntry[]>;
  graphRelationships(limit?: number): Promise<{ relationships: GraphRelationship[]; totalCount: number }>;
  graphFull(limit?: number): Promise<{ nodes: GraphNode[]; relationships: GraphRelationship[] }>;
  listEntriesPaginated(filters?: EntryFilters): Promise<PaginatedEntries>;
  fetchHealthRaw(): Promise<RawHealthResponse>;
}
```

The dashboard package also provides: `Poller` (auto-polling), `computeMetrics()`, `computeTypeDistribution()`,
`enrichHealth()`, `transformGraphData()`, `toD3ForceFormat()`, `toGraphologyFormat()`, and React hooks
(`useMemoryStats`, `useMemoryEntries`, `useKnowledgeGraph`, `useConsolidationLog`, `useMemoryHealth`, `useTypeDistribution`).

## MemorySearchResult

```typescript
interface MemorySearchResult {
  entries: MemoryEntry[];
  totalCount: number;
  strategy: RAGStrategy;
  scoredEntries?: Array<{ entry: MemoryEntry; score: number }>;  // ranked results with relevance scores
}
```

## MemoryEntry (full shape)

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  agentId?: string;
  sessionId?: string;
  metadata: Record<string, unknown>;
  embedding?: number[];         // @deprecated — managed internally by vector store
  createdAt: string;           // ISO 8601
  contentHash?: string;        // SHA-256
  importance?: number;         // 1-10
  accessCount?: number;
  lastAccessed?: string;       // ISO 8601
  parentId?: string;           // hierarchical storage
  source?: string;             // filename, URL, session ID
  eventTime?: string;          // when event happened (bi-temporal)
  ingestTime?: string;         // when stored (bi-temporal)
}
```

## MemorySearchParams + SearchFilters

```typescript
interface MemorySearchParams {
  query: string;
  type?: MemoryType;
  agentId?: string;
  limit?: number;               // default varies by engine
  strategy?: RAGStrategy;       // default: 'naive'
  filters?: SearchFilters;
  enableHyDE?: boolean;         // Hypothetical Document Embedding for query expansion
  enableRerank?: boolean;       // Cross-encoder reranking of results
}

interface SearchFilters {
  source?: string;
  importanceMin?: number;
  eventTimeRange?: [string, string];  // [start, end] ISO timestamps
  parentId?: string;
  contentType?: string;
}
```

## MemoryOptions Reference

> **Embedding is internal** — pyx-memory uses `LocalEmbeddingProvider` with BGE-M3 (1024d) automatically. You do NOT pass an `embedder` option.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `dataDir` | `string` | no | `'./data'` | Use `':memory:'` for tests (LanceDB still writes to `/tmp`) |
| `vectorProvider` | `VectorProvider` | no | `'lancedb'` | |
| `dimensions` | `number` | no | `1024` | Default: 1024 (matches internal BGE-M3 model) |
| `graphStore` | `GraphStore` | no | `undefined` | Enables graph target in store routing |
| `reasoningProvider` | `ReasoningProvider` | no | `undefined` | Enables agentic RAG |
| `llm` | `LLMCallback` | no | `undefined` | Enables LLM-powered lifecycle (consolidation, summarization, scoring) |
| `skipDuplicates` | `boolean` | no | `false` | Content-hash dedup on store |
| `agentId` | `string` | no | `undefined` | Auto-scopes ALL store/search/stats/decay operations to this agent |
| `qdrantUrl` | `string` | no | `undefined` | @deprecated — Qdrant support is vestigial |

## Embedding Dimension Defaults by Provider

> **Memory always uses `LocalEmbeddingProvider` internally.** The other providers are available for standalone use but are not used by the `Memory` class.

| Provider | Default Dimensions | Model |
|----------|-------------------|-------|
| `StubEmbeddingProvider` | 1024 | hash-based (testing only) |
| `OpenAIEmbeddingProvider` | 1536 | text-embedding-3-small |
| `AnthropicEmbeddingProvider` | 1024 | voyage-3 (Voyage AI) |
| `LocalEmbeddingProvider` | 1024 | BGE-M3 (ONNX int8 quantized) |
