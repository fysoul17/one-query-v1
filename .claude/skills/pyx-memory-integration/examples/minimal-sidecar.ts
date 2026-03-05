import { MemoryClient } from '@pyx-memory/client';

// Without auth (local dev)
const memory = new MemoryClient('http://localhost:7822');

// With auth (production — pass API key as second argument)
// const memory = new MemoryClient('http://localhost:7822', process.env.MEMORY_API_KEY);

await memory.initialize(); // verifies server connectivity via /health

await memory.store({ content: 'Important fact', type: 'long-term', metadata: {} });
const _results = await memory.search({ query: 'fact', limit: 5 });

// Start the server: bun packages/server/src/index.ts
