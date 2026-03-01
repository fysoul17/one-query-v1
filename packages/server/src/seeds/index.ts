// Seed registry — run all agent seeds on server startup

import type { AgentPool } from '@autonomy/agent-manager';
import type { CronManager } from '@autonomy/cron-manager';
import type { AgentDefinition, AgentStoreInterface } from '@autonomy/shared';
import { Logger } from '@autonomy/shared';

const logger = new Logger({ context: { source: 'seeds' } });

/** Platform awareness prefix injected into all seed agent system prompts. */
const AGENT_FORGE_AWARENESS = [
  'You are running inside agent-forge, an AI orchestration platform.',
  'Memory is automatic via pyx-memory — do NOT write files to manage memory.',
  'Use <system-action /> tags for platform operations (see system-context for docs).',
].join(' ');

function withAwareness(prompt: string): string {
  return `${AGENT_FORGE_AWARENESS}\n\n${prompt}`;
}

/** Starter agent definitions bundled with the template. */
const SEED_AGENTS: AgentDefinition[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    role: 'Research assistant that gathers, synthesizes, and summarizes information.',
    tools: [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: 'system',
    persistent: true,
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    systemPrompt: withAwareness(
      [
        'You are a Research Assistant. Your job is to help users find, synthesize, and summarize information.',
        '',
        'Guidelines:',
        '- Provide factual, well-structured responses',
        '- Cite sources when available',
        '- Ask clarifying questions when the research topic is ambiguous',
        '- Organize findings into clear sections with headings',
        '- Distinguish between established facts and your analysis',
      ].join('\n'),
    ),
  },
  {
    id: 'writer',
    name: 'Writer',
    role: 'Content writer that drafts, edits, and refines text.',
    tools: [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: 'system',
    persistent: true,
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    systemPrompt: withAwareness(
      [
        'You are a Content Writer. Your job is to draft, edit, and refine written content.',
        '',
        'Guidelines:',
        '- Match the requested tone and style (formal, casual, technical, etc.)',
        '- Structure content with clear headings and logical flow',
        '- Be concise — every sentence should add value',
        '- When editing, explain what you changed and why',
        '- Ask about target audience if not specified',
      ].join('\n'),
    ),
  },
  {
    id: 'analyst',
    name: 'Analyst',
    role: 'Data analyst that interprets data, identifies patterns, and generates insights.',
    tools: [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: 'system',
    persistent: true,
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    systemPrompt: withAwareness(
      [
        'You are a Data Analyst. Your job is to interpret data, identify patterns, and generate actionable insights.',
        '',
        'Guidelines:',
        '- Present data clearly with numbers and percentages',
        '- Highlight key trends and anomalies',
        '- Provide actionable recommendations based on analysis',
        '- Acknowledge data limitations and confidence levels',
        '- Use tables and structured formats for comparisons',
      ].join('\n'),
    ),
  },
  {
    id: 'exchange-rate-monitor',
    name: 'Exchange Rate Monitor',
    role: 'Financial data reporter that tracks and analyzes currency exchange rates.',
    tools: [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: 'system',
    persistent: true,
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    systemPrompt: withAwareness(
      [
        'You are an Exchange Rate Monitor. Your job is to analyze currency exchange rate data and report on trends.',
        '',
        'Guidelines:',
        '- Focus on KRW pairs: USD/KRW, EUR/KRW, JPY/KRW, CNY/KRW',
        '- Report current rates, daily change, and weekly trend direction',
        '- Highlight significant movements (>1% daily change)',
        '- Provide brief context for major movements (central bank decisions, economic data)',
        '- Keep reports concise — a summary table followed by 2-3 key observations',
      ].join('\n'),
    ),
  },
];

/**
 * Run all seed functions to pre-populate agents.
 * Each seed is idempotent — safe to call on every startup.
 * Seeds use `store.upsertSeed()` to avoid overwriting user modifications.
 */
export async function runSeeds(_pool: AgentPool, store: AgentStoreInterface): Promise<void> {
  logger.info('Running agent seeds...');

  let seeded = 0;
  for (const agent of SEED_AGENTS) {
    try {
      const inserted = store.upsertSeed(agent);
      if (inserted) {
        seeded++;
        logger.info('Seeded agent', { id: agent.id, name: agent.name });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn('Seed failed', { id: agent.id, error: detail });
    }
  }

  logger.info('Agent seeds complete', { total: SEED_AGENTS.length, newlySeeded: seeded });
}

/**
 * Seed cron jobs (idempotent — checks for existing crons with the same name).
 */
export async function runCronSeeds(cronManager: CronManager): Promise<void> {
  const CRON_SEED_NAME = 'Hourly Exchange Rate Report';

  const existing = cronManager.list();
  if (existing.some((c) => c.name === CRON_SEED_NAME)) {
    logger.info('Cron seed already exists, skipping', { name: CRON_SEED_NAME });
    return;
  }

  try {
    await cronManager.create({
      name: CRON_SEED_NAME,
      schedule: '0 * * * *',
      enabled: true,
      workflow: {
        steps: [
          {
            agentId: 'exchange-rate-monitor',
            task: [
              'Analyze the current exchange rates for the following currency pairs:',
              'USD/KRW, EUR/KRW, JPY/KRW, CNY/KRW.',
              'Report the latest rates, daily percentage changes, and any notable trends.',
              'Keep it concise — a summary table plus 2-3 key observations.',
            ].join(' '),
          },
        ],
        output: 'last',
      },
    });
    logger.info('Cron seed created', { name: CRON_SEED_NAME });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn('Cron seed failed', { name: CRON_SEED_NAME, error: detail });
  }
}
