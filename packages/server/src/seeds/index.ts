// Seed registry — run all agent seeds on server startup

import type { AgentPool } from '@autonomy/agent-manager';
import { Logger } from '@autonomy/shared';
import { seedYoutubeShortsAgent } from './youtube-shorts-agent.ts';
import { seedShortsEditor } from './shorts-editor.ts';
import { seedShortsHookOptimizer } from './shorts-hook-optimizer.ts';
import { seedShortsSeoSpecialist } from './shorts-seo-specialist.ts';
import { seedShortsTrendResearcher } from './shorts-trend-researcher.ts';

const logger = new Logger({ context: { source: 'seeds' } });

/**
 * Run all seed functions to pre-populate agents.
 * Each seed is idempotent — safe to call on every startup.
 */
export async function runSeeds(pool: AgentPool): Promise<void> {
  logger.info('Running agent seeds...');

  const seeds = [
    // Core YouTube Shorts script generator
    seedYoutubeShortsAgent,
    // Multi-agent team: YouTube Shorts pipeline
    seedShortsTrendResearcher,
    seedShortsHookOptimizer,
    seedShortsEditor,
    seedShortsSeoSpecialist,
  ];

  for (const seed of seeds) {
    try {
      await seed(pool);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn('Seed failed', { error: detail });
    }
  }

  logger.info('Agent seeds complete');
}
