# Advanced Features

## RAG Strategies

| Strategy | How It Works | Requirements |
|----------|-------------|--------------|
| `'naive'` | Embed query → vector similarity → top-K | (default, always available) |
| `'graph'` | Extract entities → graph traversal → context expansion | `graphStore` in MemoryOptions |
| `'hybrid'` | BM25 + vector + graph + community summaries → RRF fusion (k=60) → reranking | `graphStore` in MemoryOptions |
| `'agentic'` | LLM decides strategy → iterative refinement (3 rounds) | `reasoningProvider` in MemoryOptions |

```typescript
// Naive (default)
await memory.search({ query: 'user preferences', limit: 10 });

// Graph
await memory.search({ query: 'who works at Acme', strategy: 'graph', limit: 10 });

// Hybrid (recommended for best quality)
await memory.search({ query: 'deployment config', strategy: 'hybrid', limit: 10 });

// With query transformation (HyDE generates hypothetical answer, embeds that instead)
// EMBEDDED ONLY — enableHyDE not forwarded by HTTP API
await memory.search({ query: 'deployment config', strategy: 'hybrid', enableHyDE: true });

// With reranking (cross-encoder scores each result for precision)
// EMBEDDED ONLY — enableRerank not forwarded by HTTP API
await memory.search({ query: 'deployment config', strategy: 'hybrid', enableRerank: true });
```

### Retrieval Pipeline (Hybrid Strategy)

```
Query → Stage 0: Transform (decompose, HyDE, multi-query)
      → Stage 1: Parallel retrieval (BM25/FTS5 + dense vector + graph traverse + community summaries)
      → Stage 2: RRF fusion (k=60) + dedup
      → Stage 3: Cross-encoder reranking → top-N
```

---

## Bi-Temporal Model

Every entry tracks two timestamps for temporal reasoning:

- **`eventTime`**: When the fact/event actually occurred
- **`ingestTime`**: When it was stored in memory (auto-set)

**Sidecar note**: All `StoreInput` fields (including `eventTime`, `id`, `parentId`, `ingestTime`) are forwarded by `MemoryClient.store()`. Temporal search filters (`eventTimeRange`, `asOf`) are forwarded by `MemoryClient.search()`. However, `filters` (source, importanceMin, parentId, contentType), `enableHyDE`, and `enableRerank` are still not forwarded by the search endpoint.

```typescript
// Store with explicit event time (works in both embedded and sidecar)
await memory.store({
  content: 'User changed address to 123 Main St',
  type: 'long-term',
  metadata: {},
  eventTime: '2026-01-15T00:00:00Z',  // when it happened
});

// Query as-of (available via MemoryClient.queryAsOf() or HTTP endpoint)
const snapshot = await memory.queryAsOf('2026-01-20T00:00:00Z', { type: 'long-term' });

// Query by event time range (available via MemoryClient.queryByEventTime() or HTTP endpoint)
const events = await memory.queryByEventTime('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');

// Filter by event time range in search (EMBEDDED ONLY via filters param)
await memory.search({
  query: 'address',
  filters: { eventTimeRange: ['2026-01-01', '2026-02-01'] },
});
```

---

## Consolidation Pipeline

When `consolidate()` runs, it executes a 7-step pipeline:

1. **Extract facts** — LLM or regex extraction of factual statements
2. **Deduplicate** — Content hash + vector similarity (>0.90) → LLM classifies ADD/UPDATE/DELETE/NOOP
3. **Resolve conflicts** — Detect contradictions, resolve by recency and source trust
4. **Score importance** — LLM rates 1-10 (or heuristic: recency + access count + entity density)
5. **Enrich graph** — Extract entities and relationships, merge with existing graph
6. **Summarize** — Rolling session summaries, memory compaction
7. **Decay** — Archive entries below importance threshold: `importance * 0.995^hours * (1 + 0.02 * min(accessCount, 20)) * eventAgeFactor`

All steps have **non-LLM fallbacks** — consolidation works without an LLM, just less intelligently.

---

## Community Detection

When a `graphStore` is configured, the system can detect communities of related entities using the Louvain algorithm:

```typescript
import { CommunityDetector } from '@pyx-memory/core';

const detector = new CommunityDetector(graphStore, llm);
const communities = await detector.detect();
// Each community: { id, nodeIds, summary? }
// Summaries are used by hybrid RAG for corpus-level queries
```

Communities are leveraged by the hybrid RAG strategy to answer broad "what are the themes" queries.

---

## Automatic Behaviors

These happen automatically — no configuration needed:

- **PII detection**: Every `store()` scans content and sets `metadata.piiDetected` + `metadata.piiTypes` if found
- **Content hashing**: Every `store()` computes SHA-256 `contentHash`
- **Access tracking**: Every `search()` increments `accessCount` and updates `lastAccessed` on returned entries
- **FTS5 sync**: SQLite triggers keep full-text search index in sync with memory_entries
- **Graph storage**: When `targets` includes `'graph'`, agent-provided `entities` are stored to the graph (best-effort — failures don't block store)
- **Auto-registration on import**: Importing `@pyx-memory/core` registers StubEmbeddingProvider, LanceDBProvider, and NaiveRAGEngine
- **Graph/Agentic RAG registration**: Memory constructor auto-registers GraphRAGEngine and AgenticRAGEngine when you pass `graphStore` or `reasoningProvider`
- **Agent scoping**: If `agentId` is set in MemoryOptions, all operations auto-filter by that agent

---

## Initialization Sequence

```
1. (Optional) Create and await graphStore.initialize()
2. Construct: new Memory({ graphStore?, llm?, ... })   ← embedding is internal (BGE-M3)
3. Await: memory.initialize()    ← creates SQLite DB + LanceDB vector store
4. Use: store(), search(), etc.
5. Cleanup: await memory.shutdown()
6. (Optional) await graphStore.shutdown()
```

**Memory.initialize()** creates:
- SQLite database at `{dataDir}/memory/memory.db` (with FTS5 + migrations)
- LanceDB vector store at `{dataDir}/vectors/`
- Both directories are created automatically (mkdirSync recursive)

**Memory does NOT** call `graphStore.initialize()` — you must do this yourself before or after constructing Memory, but before calling `memory.initialize()`.
