// Seed registry — run all agent seeds on server startup

import type { AgentPool } from '@autonomy/agent-manager';
import type { AgentDefinition, AgentStoreInterface } from '@autonomy/shared';
import { Logger } from '@autonomy/shared';

const logger = new Logger({ context: { source: 'seeds' } });

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
    systemPrompt: [
      'You are a Research Assistant. Your job is to help users find, synthesize, and summarize information.',
      '',
      'Guidelines:',
      '- Provide factual, well-structured responses',
      '- Cite sources when available',
      '- Ask clarifying questions when the research topic is ambiguous',
      '- Organize findings into clear sections with headings',
      '- Distinguish between established facts and your analysis',
    ].join('\n'),
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
    systemPrompt: [
      'You are a Content Writer. Your job is to draft, edit, and refine written content.',
      '',
      'Guidelines:',
      '- Match the requested tone and style (formal, casual, technical, etc.)',
      '- Structure content with clear headings and logical flow',
      '- Be concise — every sentence should add value',
      '- When editing, explain what you changed and why',
      '- Ask about target audience if not specified',
    ].join('\n'),
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
    systemPrompt: [
      'You are a Data Analyst. Your job is to interpret data, identify patterns, and generate actionable insights.',
      '',
      'Guidelines:',
      '- Present data clearly with numbers and percentages',
      '- Highlight key trends and anomalies',
      '- Provide actionable recommendations based on analysis',
      '- Acknowledge data limitations and confidence levels',
      '- Use tables and structured formats for comparisons',
    ].join('\n'),
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
