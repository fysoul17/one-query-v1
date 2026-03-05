# Embedded Integration Patterns

For projects using pyx-memory directly in-process with full feature access.

## Contents
- [Pattern 1: Testing / Development](#pattern-1-testing--development)
- [Pattern 2: Production](#pattern-2-production)
- [Pattern 3: Production with Store Targets](#pattern-3-production-with-store-targets)
- [Pattern 4: With Knowledge Graph](#pattern-4-with-knowledge-graph)
- [Pattern 5: With LLM Lifecycle](#pattern-5-with-llm-lifecycle)
- [Pattern 6: File Ingestion](#pattern-6-file-ingestion)
- [Pattern 7: Factory with Auto-Mode Switching](#pattern-7-factory-with-auto-mode-switching)
- [Adding as Git Submodule](#adding-as-git-submodule-recommended-for-embedded-mode)
- [MemoryOptions Quick Reference](#memoryoptions-quick-reference)

---

## Pattern 1: Testing / Development

```typescript
import { Memory } from '@pyx-memory/core';

const memory = new Memory({ dataDir: ':memory:' });
await memory.initialize();
// Memory internally creates a LocalEmbeddingProvider (BGE-M3, 1024d)
// No embedder needed — embedding is fully managed
```

## Pattern 2: Production

```typescript
import { Memory } from '@pyx-memory/core';

const memory = new Memory({ dataDir: './data' });
await memory.initialize();
// Embedding is handled internally by LocalEmbeddingProvider (BGE-M3 via @huggingface/transformers, 1024d)
// No external embedding provider needed
```

## Pattern 3: Production with Store Targets

```typescript
import { Memory } from '@pyx-memory/core';

const memory = new Memory({ dataDir: './data' });
await memory.initialize();

// Default: stores to sqlite + vector
await memory.store({
  content: 'User prefers dark mode',
  type: 'long-term',
  metadata: { source: 'settings' },
});

// Explicit targets: sqlite only (skip vector indexing)
await memory.store({
  content: 'Temporary note',
  type: 'working',
  metadata: {},
  targets: ['sqlite'],
});
```

## Pattern 4: With Knowledge Graph

```typescript
import { Memory, createGraphStore } from '@pyx-memory/core';
import type { StoreTarget, IngestEntity, IngestRelationship } from '@pyx-memory/shared';

// 1. Create and initialize graph store BEFORE Memory
const graphStore = createGraphStore({}); // returns SQLiteGraphStore (default)
await graphStore.initialize({});         // REQUIRED — Memory does NOT init this for you

// For Neo4j instead: createGraphStore({ neo4jUrl: 'bolt://localhost:7687' })

const memory = new Memory({
  dataDir: './data',
  graphStore, // enables graph RAG search
});
await memory.initialize();

// Graph storage is agent-driven — YOU provide entities and relationships explicitly
await memory.store({
  content: 'Alice works at Acme Corp as a senior engineer',
  type: 'long-term',
  metadata: {},
  targets: ['sqlite', 'vector', 'graph'],
  entities: [
    { name: 'Alice', type: 'PERSON', properties: { role: 'senior engineer' } },
    { name: 'Acme Corp', type: 'ORGANIZATION' },
  ],
  relationships: [
    { source: 'Alice', target: 'Acme Corp', type: 'WORKS_AT' },
  ],
});

// Graph-aware search
const results = await memory.search({ query: 'Alice employer', strategy: 'graph' });

// Cleanup both
await memory.shutdown();
await graphStore.shutdown();
```

## Pattern 5: With LLM Lifecycle

```typescript
import { Memory } from '@pyx-memory/core';
import type { LLMCallback } from '@pyx-memory/core';

// LLMCallback: any function that takes a prompt string and returns a completion string
const llm: LLMCallback = async (prompt) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json() as any;
  return data.content[0].text;
};

const memory = new Memory({
  dataDir: './data',
  llm, // enables LLM-powered lifecycle
});
await memory.initialize();

// Now lifecycle methods use LLM intelligence
await memory.consolidate();                    // LLM scoring + dedup + conflict resolution
await memory.summarizeSession('session-123');   // LLM summarization
await memory.runDecay();                        // importance-based archival
```

**Without LLM**: Lifecycle still works using heuristic fallbacks (regex extraction, embedding-distance dedup, formula-based scoring). LLM makes it smarter, not mandatory.

## Pattern 6: File Ingestion

```typescript
import { IngestionAgent, Memory } from '@pyx-memory/core';

const memory = new Memory({ dataDir: './data' });
await memory.initialize();

const agent = new IngestionAgent({
  llm: myLlmCallback,                          // optional: smart classification + enrichment
  embedder: (texts) => myEmbedder.embed(texts), // optional: semantic chunking (separate from Memory's internal embedder)
  useSemanticChunking: true,
  useStructuralChunking: false,
  enableEnrichment: true,
  enableMetadata: true,
  enableHierarchical: false,                    // requires LLM
});

// Supported: .txt, .md, .csv, .pdf, .docx, .json, .html
const buffer = Buffer.from(await Bun.file('report.pdf').arrayBuffer());
const result = await agent.ingest(buffer, 'report.pdf', memory);
// result: { filename, fileType, chunks, entryIds, totalCharacters }
```

**Note**: `IngestionAgent` may accept its own `embedder` for semantic chunking. This is separate from Memory's internal embedding — Memory handles its own embedding automatically.

## Pattern 7: Factory with Auto-Mode Switching

```typescript
import { createMemory } from '@pyx-memory/core';

// Embedded mode (default)
const memory = createMemory({
  dataDir: './data',
});

// Sidecar mode (when MEMORY_URL is set)
const remote = createMemory({
  memoryUrl: process.env.MEMORY_URL, // e.g., 'http://localhost:7822'
  apiKey: process.env.MEMORY_API_KEY,
});

await memory.initialize();

// WARNING: createMemory() returns MemoryInterface, NOT ExtendedMemoryInterface.
// If you need lifecycle methods, cast:
// const extended = memory as ExtendedMemoryInterface;
// Or prefer `new Memory()` / `new MemoryClient()` directly.
```

---

## Adding as Git Submodule (Recommended for Embedded Mode)

```bash
git submodule add https://github.com/fysoul17/pyx-memory-v1.git vendor/pyx-memory
```

Add to your `package.json` workspaces:

```json
{
  "workspaces": [
    "packages/*",
    "vendor/pyx-memory/packages/shared",
    "vendor/pyx-memory/packages/client",
    "vendor/pyx-memory/packages/core"
  ]
}
```

Then: `bun install`

---

## MemoryOptions Quick Reference

`embedder` has been removed from MemoryOptions. Memory internally creates a `LocalEmbeddingProvider` using BGE-M3 (1024 dimensions) via `@huggingface/transformers`. You never need to provide an embedding function.

See [reference/types.md](../reference/types.md#memoryoptions-reference) for the full MemoryOptions table.
