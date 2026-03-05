---
name: pyx-memory-integration
description: >
  Integration guide for the pyx-memory universal memory system (TypeScript/Bun).
  Use when integrating pyx-memory into a project, migrating to pyx-memory,
  setting up embedded or sidecar memory, asking about pyx-memory API or types,
  configuring RAG strategies, file ingestion, or lifecycle management.
  Triggers on: 'integrate pyx-memory', 'add memory system', 'setup pyx-memory',
  'memory store search', 'MemoryInterface', 'EmbeddingProvider', 'createMemory',
  'pyx-memory configuration', 'memory consolidation', 'graph RAG'.
---

# pyx-memory — AI Agent Integration Guide

Reference for AI agents integrating pyx-memory into TypeScript/Bun projects.
Runtime requirement: **Bun v1.2+** (not Node.js). Uses `bun:sqlite` natively.

> After integration work, run the diagnostic tool to verify correctness:
> ```bash
> bun .claude/skills/pyx-memory-integration/scripts/diagnose-integration.ts --json
> ```
> Parse the `verdict` field: `"healthy"` = done, otherwise fix each `criticalIssues` entry and re-run.

---

## What are you trying to do?

**Integrate pyx-memory into a consumer project?**
  → See [patterns/consumer.md](patterns/consumer.md)

**Set up embedded memory with full features?**
  → See [patterns/embedded.md](patterns/embedded.md)

**Understand type signatures and interfaces?**
  → See [reference/types.md](reference/types.md)

**Check sidecar limitations before choosing a mode?**
  → See [reference/parity.md](reference/parity.md)

**Use the HTTP API directly?**
  → See [reference/http-api.md](reference/http-api.md)

**Configure RAG, bi-temporal queries, or consolidation?**
  → See [reference/advanced.md](reference/advanced.md)

**Validate your integration setup?**
  → Run: `bun .claude/skills/pyx-memory-integration/scripts/diagnose-integration.ts`

**Check server connectivity?**
  → Run: `bun .claude/skills/pyx-memory-integration/scripts/diagnose-integration.ts --phase=runtime`

**Get machine-readable diagnostic report?**
  → Run: `bun .claude/skills/pyx-memory-integration/scripts/diagnose-integration.ts --json`

---

## Quick Decision Tree

```
Building pyx-memory itself or its server?
  → Embedded mode: import { Memory } from '@pyx-memory/core'

Consuming pyx-memory from another project (e.g., agent-forge)?
  → Sidecar mode: import { MemoryClient } from '@pyx-memory/client'
  → ONLY depend on @pyx-memory/client + @pyx-memory/shared
  → Do NOT import @pyx-memory/core — that's pyx-memory's internal implementation
  → See patterns/consumer.md

Need memory in your process (best perf, full feature set)?
  → Embedded mode: import { Memory } from '@pyx-memory/core'

Need memory as a separate service (HTTP)?
  → Sidecar mode: import { MemoryClient } from '@pyx-memory/client'

Need to switch modes via config?
  → Factory: import { createMemory } from '@pyx-memory/core'
    - Returns MemoryInterface (base interface — no lifecycle methods)
    - If you need consolidate/decay/summarize, use `new Memory()` directly

Need lifecycle methods (consolidate, decay, summarize)?
  → Use `new Memory(opts)` — returns ExtendedMemoryInterface
  → Or `new MemoryClient(url)` — also implements ExtendedMemoryInterface
  → NOT createMemory() — it returns MemoryInterface (missing lifecycle methods)

Need dashboard features (consolidation log, graph visualization)?
  → Use `DashboardClient` from '@pyx-memory/dashboard'
  → Extends MemoryClient with additional methods
```

---

## Minimal Working Example (Embedded)

```typescript
import { Memory } from '@pyx-memory/core';

// Embedding is internal — pyx-memory uses BGE-M3 (1024d) automatically
const memory = new Memory({ dataDir: './data' });
await memory.initialize(); // REQUIRED — throws if you skip this

// Store (default targets: sqlite + vector)
await memory.store({
  content: 'User prefers dark mode',
  type: 'long-term',
  metadata: { source: 'settings' },
});

// Store with graph routing (agent provides entities)
await memory.store({
  content: 'Alice works at Acme Corp',
  type: 'long-term',
  metadata: {},
  targets: ['sqlite', 'vector', 'graph'],
  entities: [
    { name: 'Alice', type: 'PERSON' },
    { name: 'Acme Corp', type: 'ORGANIZATION' },
  ],
  relationships: [{ source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' }],
});

// Search
const results = await memory.search({ query: 'user preferences', limit: 5 });

// Cleanup
await memory.shutdown(); // REQUIRED — releases SQLite + LanceDB resources
```

## Minimal Working Example (Sidecar / HTTP)

```typescript
import { MemoryClient } from '@pyx-memory/client';

// Without auth (local dev)
const memory = new MemoryClient('http://localhost:7822');

// With auth (production — pass API key as second argument)
const authedMemory = new MemoryClient('http://localhost:7822', process.env.MEMORY_API_KEY);

await memory.initialize(); // verifies server connectivity via /health

await memory.store({ content: 'Important fact', type: 'long-term', metadata: {} });
const results = await memory.search({ query: 'fact', limit: 5 });
```

Start the server: `bun packages/server/src/index.ts`

---

## Package Map

```
@pyx-memory/shared   → Types + constants only (zero runtime code)
       ↑       ↑
       |       |
@pyx-memory/client   → MemoryInterface, ExtendedMemoryInterface, MemoryClient
       ↑
       |
@pyx-memory/core     → Memory class, embeddings, graph, RAG, ingestion, lifecycle
       ↑                (re-exports everything from client and shared)
       |
@pyx-memory/server   → HTTP sidecar server (23 endpoints)

@pyx-memory/dashboard → DashboardClient (extends MemoryClient), React hooks,
                         Poller, aggregations, graph transforms (D3/Graphology)
```

**Import rules:**
- **Embedded mode**: Import everything from `@pyx-memory/core` (it re-exports client + shared)
- **Sidecar mode (client only)**: Import from `@pyx-memory/client` (+ types from `@pyx-memory/shared`)
- **Dashboard features**: Import from `@pyx-memory/dashboard` (extends client with extra methods)
- **Types only**: Import from `@pyx-memory/shared`
- **Consumer projects**: ONLY use `@pyx-memory/client` + `@pyx-memory/shared` — never `@pyx-memory/core`

For full type definitions and interfaces, see [reference/types.md](reference/types.md).

For HTTP API endpoint reference, see [reference/http-api.md](reference/http-api.md).

For feature parity between embedded and sidecar modes, see [reference/parity.md](reference/parity.md).

For RAG strategies, bi-temporal model, consolidation, and community detection, see [reference/advanced.md](reference/advanced.md).

---

## DO / DON'T

### DO

- **DO** call `await memory.initialize()` before any operation
- **DO** call `await memory.shutdown()` when done (releases SQLite + LanceDB)
- **DO** provide `entities` when using `targets: ['graph']` — graph storage requires agent-provided entities
- **DO** initialize GraphStore BEFORE constructing Memory
- **DO** use `new Memory()` when you need lifecycle methods (ExtendedMemoryInterface)
- **DO** use `':memory:'` dataDir for tests
- **DO** handle `MemoryServerError` in sidecar mode (has `.status` and `.isNotFound`)
- **DO** use `MemoryClient` (not `MemoryInterface`) when you need graph or file ingestion — these are concrete methods
- **DO** use `DashboardClient` when you need consolidation logs, graph relationships, or enriched health data
- **DO** implement `DisabledMemory` (no-op) in consumer projects for graceful degradation when memory is unavailable

### DON'T

- **DON'T** assume `createMemory()` returns `ExtendedMemoryInterface` — it returns `MemoryInterface`
- **DON'T** use `targets: ['graph']` without entities — throws MemoryError
- **DON'T** use `targets: ['graph']` without a configured `graphStore` — throws MemoryError
- **DON'T** use `strategy: 'graph'` without passing `graphStore` — throws "RAG strategy not registered"
- **DON'T** use `strategy: 'agentic'` without passing `reasoningProvider`
- **DON'T** construct multiple Memory instances with the same `dataDir` — LanceDB singleton causes conflicts
- **DON'T** use `':memory:'` in production — LanceDB still writes to `/tmp/autonomy-vectors`
- **DON'T** expose the server without configuring `API_KEY` for network deployments — use an API gateway for internet-facing deployments
- **DON'T** import `@pyx-memory/core` in consumer projects — use `@pyx-memory/client` for clean separation
- **DON'T** expect `filters`, `enableHyDE`, or `enableRerank` to work in sidecar mode — the HTTP API doesn't forward them

---

## AI Agent Post-Integration Checklist

After integrating pyx-memory, run the diagnostic tool to verify everything is wired correctly:

```bash
bun .claude/skills/pyx-memory-integration/scripts/diagnose-integration.ts --json
```

**Interpret the result:**
1. Parse the JSON `verdict` field:
   - `"healthy"` → Integration is complete and working
   - `"misconfigured"` → Environment or config issues — fix each item in `criticalIssues`
   - `"broken"` → Server is down or unreachable — start the server first
   - `"degraded"` → Working but with warnings (e.g., stub embeddings)
2. For each entry in `criticalIssues`, apply the `fix` instruction
3. Re-run until `verdict === "healthy"`

**Common failure: DisabledMemory (no-op)**
If `MEMORY_URL` is not set, the client will silently fall back to a DisabledMemory no-op implementation. Everything appears to work (store returns success, health reports "ok") but nothing is actually persisted. The diagnostic tool detects this via checks S5 (missing URL) and I1 (empty store ID).

---

## Error Types

```
MemoryError (base)
├── MemoryStoreError        — SQLite store failures
├── MemoryNotFoundError     — entry not found
├── MemorySearchError       — search failures
├── VectorProviderError     — LanceDB/vector issues
├── EmbeddingError          — embedding generation failures
├── MigrationError          — schema migration issues
├── IngestionError          — file parsing / ingestion failures
├── LifecycleError          — consolidation / decay failures
└── GraphError              — graph store operations

MemoryServerError           — HTTP client errors (has .status, .isNotFound)
```

All from `@pyx-memory/core` except `MemoryServerError` from `@pyx-memory/client`.

---

## Copy-Paste Examples

- [examples/minimal-embedded.ts](examples/minimal-embedded.ts) — Embedded setup with store/search/shutdown
- [examples/minimal-sidecar.ts](examples/minimal-sidecar.ts) — Sidecar HTTP client setup
- [examples/disabled-memory.ts](examples/disabled-memory.ts) — No-op DisabledMemory class for graceful degradation

## Further Reading

- `docs/ARCHITECTURE.md` — Deep architecture reference, research sources, cost analysis, competitive positioning
- `README.md` — Project overview, HTTP API examples, deployment guides, Docker setup
