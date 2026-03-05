import { Memory } from '@pyx-memory/core';

const memory = new Memory({ dataDir: './data' });
await memory.initialize(); // REQUIRED — throws if you skip this

// Store (default targets: sqlite + vector)
await memory.store({
  content: 'User prefers dark mode',
  type: 'long-term',
  metadata: { source: 'settings' },
});

// Store with explicit targets (e.g., sqlite only)
await memory.store({
  content: 'Temporary working note',
  type: 'working',
  metadata: {},
  targets: ['sqlite'],
});

// Search
const _results = await memory.search({ query: 'user preferences', limit: 5 });

// Cleanup
await memory.shutdown(); // REQUIRED — releases SQLite + LanceDB resources
