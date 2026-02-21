// Seed: YouTube Shorts Cron Automation
// Sets up scheduled jobs for daily trend research and weekly content planning

import type { CronManager } from '@autonomy/cron-manager';
import { Logger } from '@autonomy/shared';
import { SHORTS_TREND_RESEARCHER_ID } from './shorts-trend-researcher.ts';
import { YOUTUBE_SHORTS_AGENT_ID } from './youtube-shorts-agent.ts';

const logger = new Logger({ context: { source: 'seed:shorts-crons' } });

export async function seedShortsCronJobs(cronManager: CronManager): Promise<void> {
  const existing = cronManager.list();

  // Daily Trend Research — every morning at 8 AM KST (23:00 UTC)
  const trendResearchExists = existing.some((c) => c.name === 'Shorts Daily Trend Research');
  if (!trendResearchExists) {
    try {
      await cronManager.create({
        name: 'Shorts Daily Trend Research',
        schedule: '0 23 * * *', // 8 AM KST = 23:00 UTC previous day
        timezone: 'UTC',
        enabled: true,
        workflow: {
          output: 'daily-trend-report',
          steps: [
            {
              agentId: SHORTS_TREND_RESEARCHER_ID,
              task: `Perform today's daily trend research for YouTube Shorts.

Analyze:
1. What topics are trending right now across all major niches (tech, lifestyle, finance, health, entertainment)
2. Which content formats are getting the most engagement this week
3. Seasonal or timely opportunities for the next 7 days
4. Top 5 content opportunities ranked by virality potential

Output a comprehensive trend report that creators can use today.`,
            },
          ],
        },
      });
      logger.info('Shorts Daily Trend Research cron created');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to create Shorts Daily Trend Research cron', { error: detail });
    }
  }

  // Weekly Content Batch — every Monday at 9 AM KST (00:00 UTC Monday)
  const weeklyBatchExists = existing.some((c) => c.name === 'Shorts Weekly Content Batch');
  if (!weeklyBatchExists) {
    try {
      await cronManager.create({
        name: 'Shorts Weekly Content Batch',
        schedule: '0 0 * * 1', // Every Monday at midnight UTC (9 AM KST)
        timezone: 'UTC',
        enabled: true,
        workflow: {
          output: 'weekly-content-batch',
          steps: [
            {
              agentId: SHORTS_TREND_RESEARCHER_ID,
              task: `Generate a WEEKLY CONTENT PLAN for YouTube Shorts.

Create a structured 7-day content calendar with:
- Monday: [trending topic script idea]
- Tuesday: [educational/how-to script idea]
- Wednesday: [entertainment/viral format script idea]
- Thursday: [motivational/mindset script idea]
- Friday: [product/review script idea]
- Saturday: [behind-the-scenes/personal script idea]
- Sunday: [community engagement / Q&A script idea]

For each day, provide:
1. Topic title
2. Target niche/audience
3. Hook idea
4. Estimated virality potential (1-10)
5. Best posting time

This plan should be ready to hand off to the Script Writer for production.`,
            },
            {
              agentId: YOUTUBE_SHORTS_AGENT_ID,
              task: `Based on the weekly trend report just provided, write a full YouTube Shorts script for the HIGHEST PRIORITY opportunity identified.

Create a complete, production-ready script using the standard format:
- TITLE, Duration, Hook Type, Tags
- HOOK (0-3s) with visual directions
- BUILD (3-20s) with visual directions
- PAYOFF (20-50s) with visual directions
- CTA (50-60s) with visual directions
- 3 alternative hook variations

Make this script ready to shoot immediately.`,
            },
          ],
        },
      });
      logger.info('Shorts Weekly Content Batch cron created');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to create Shorts Weekly Content Batch cron', { error: detail });
    }
  }

  logger.info('Shorts cron jobs seeding complete');
}
