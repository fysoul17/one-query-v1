// Seed registry — run all agent seeds on server startup

import type { AgentPool } from '@autonomy/agent-manager';
import type { AgentStoreInterface } from '@autonomy/shared';
import { Logger } from '@autonomy/shared';

const logger = new Logger({ context: { source: 'seeds' } });

/**
 * Run all seed functions to pre-populate agents.
 * Each seed is idempotent — safe to call on every startup.
 * Seeds use `store.upsertSeed()` to avoid overwriting user modifications.
 */
export async function runSeeds(_pool: AgentPool, _store: AgentStoreInterface): Promise<void> {
  logger.info('Running agent seeds...');

  const seeds: Array<(pool: AgentPool, store: AgentStoreInterface) => Promise<void>> = [
    // Register your agent seeds here, e.g.:
    // seedMyAgent,
  ];

  for (const seed of seeds) {
    try {
      await seed(_pool, _store);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn('Seed failed', { error: detail });
    }
  }

  logger.info('Agent seeds complete');
}
