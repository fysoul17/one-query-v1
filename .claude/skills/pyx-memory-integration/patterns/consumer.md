# Consumer Integration Patterns

For downstream projects that **consume** pyx-memory (e.g., agent-forge, custom AI agents).

**Rule: Only depend on `@pyx-memory/client` + `@pyx-memory/shared`. Never import `@pyx-memory/core`.**

`@pyx-memory/core` is pyx-memory's internal implementation (SQLiteStore, LanceDB, embedding providers,
RAG engines, graph stores). Importing it creates tight coupling — any internal change can break your project.

---

## Pattern 8: Consumer (Sidecar-Only)

```typescript
import { MemoryClient, MemoryServerError } from '@pyx-memory/client';
import type { MemoryInterface, ExtendedMemoryInterface } from '@pyx-memory/client';
import type { MemoryEntry, MemorySearchResult } from '@pyx-memory/shared';

const MEMORY_URL = process.env.MEMORY_URL; // e.g., 'http://localhost:7822'

let memory: MemoryClient | null = null;

if (MEMORY_URL) {
  memory = new MemoryClient(MEMORY_URL, process.env.MEMORY_API_KEY);
  await memory.initialize(); // verifies connectivity
}

// Use memory if available
if (memory) {
  await memory.store({ content: 'fact', type: 'long-term', metadata: {} });
  const results = await memory.search({ query: 'fact', limit: 5 });

  // Graph queries — available on MemoryClient directly (no @pyx-memory/core needed)
  const nodes = await memory.graphNodes();
  const traversal = await memory.graphQuery({ nodeId: 'node-1', depth: 2 });

  // File ingestion — also available on MemoryClient
  const file = new File([buffer], 'report.pdf', { type: 'application/pdf' });
  const result = await memory.ingestFile(file);

  // Lifecycle
  await memory.consolidate();
  await memory.runDecay();
}
```

---

## Pattern 9: Graceful Degradation (DisabledMemory)

When your project should work with or without pyx-memory, implement a no-op wrapper.
See [examples/disabled-memory.ts](../examples/disabled-memory.ts) for a copy-paste ready implementation.

```typescript
import { MemoryClient } from '@pyx-memory/client';

const memory: MemoryInterface = process.env.MEMORY_URL
  ? new MemoryClient(process.env.MEMORY_URL, process.env.MEMORY_API_KEY)
  : new DisabledMemory();

await memory.initialize();
```

---

## Health Endpoint Pattern

Report memory status in your app's health check:

```typescript
// In your health route
const memoryStatus = process.env.MEMORY_URL
  ? { status: 'connected', url: process.env.MEMORY_URL }
  : { status: 'disabled' };
```

---

## Adding as Sidecar (Docker)

```yaml
# docker-compose.yaml
services:
  memory:
    build:
      context: ./vendor/pyx-memory
      dockerfile: docker/Dockerfile
    ports:
      - "7822:7822"
    volumes:
      - memory-data:/data
    environment:
      - DATA_DIR=/data
      # Embedding is internal (BGE-M3, 1024d) — no API keys needed
      # - EMBEDDING_DIMENSIONS=1024  # optional override

  your-app:
    environment:
      - MEMORY_URL=http://memory:7822

volumes:
  memory-data:
```
