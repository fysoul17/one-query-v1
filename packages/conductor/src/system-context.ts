// system-context.ts — Builds a dynamic <system-context> preamble for agent prompts

import type { AgentRuntimeInfo } from '@autonomy/shared';

export interface SystemContextConfig {
  /** Currently running agents from pool.list() */
  agents: AgentRuntimeInfo[];
  /** Whether a CronManager is available */
  cronEnabled: boolean;
  /** Whether the pyx-memory service is connected */
  memoryConnected: boolean;
}

const PLATFORM_IDENTITY = [
  'You are running inside agent-forge, an AI orchestration platform.',
  'You are one of potentially many agents managed by a Conductor.',
  'You are running in autonomous headless mode — all tool permissions are pre-approved.',
  'Use tools like WebFetch, Read, Write, and Bash directly without asking the user for permission.',
].join(' ');

const MEMORY_RULES_CONNECTED = [
  'Memory is automatic — the Conductor stores your conversations in pyx-memory (a RAG memory system).',
  'Do NOT write files to manage memory. Do NOT confuse pyx-memory with CLAUDE.md or any local config.',
  'If you need to recall something, ask the user or use a <system-action type="search_memory" /> tag.',
].join(' ');

const MEMORY_RULES_DISABLED =
  'Memory is NOT connected — pyx-memory service is unavailable. Do NOT claim to store or search memory. Do NOT use search_memory actions. Conversations are ephemeral and will not be persisted.';

const ACTION_DOCS_HEADER = 'You can request platform operations using self-closing XML tags:';

interface ActionDoc {
  type: string;
  description: string;
  attrs: string;
}

const CORE_ACTIONS: ActionDoc[] = [
  {
    type: 'create_agent',
    description: 'Spawn a new agent',
    attrs: 'name="..." role="..." systemPrompt="..."',
  },
];

const MEMORY_ACTION: ActionDoc = {
  type: 'search_memory',
  description: 'Search long-term memory',
  attrs: 'query="..." limit="5"',
};

const CRON_ACTION: ActionDoc = {
  type: 'create_cron',
  description: 'Create a scheduled task',
  attrs: 'name="..." schedule="0 * * * *" agentId="..." task="..."',
};

function formatActionDoc(action: ActionDoc): string {
  return `  <system-action type="${action.type}" ${action.attrs} />  — ${action.description}`;
}

function formatAgentList(agents: AgentRuntimeInfo[]): string {
  if (agents.length === 0) return 'No other agents are currently running.';
  const lines = agents.map((a) => `  - ${a.name} (${a.id}): ${a.role} [${a.status}]`);
  return `Active agents:\n${lines.join('\n')}`;
}

/**
 * Build the system context preamble that tells agents what platform they're on,
 * what memory rules to follow, and what system actions are available.
 */
export function buildSystemContextPreamble(config: SystemContextConfig): string {
  const actions = [...CORE_ACTIONS];
  if (config.memoryConnected) {
    actions.push(MEMORY_ACTION);
  }
  if (config.cronEnabled) {
    actions.push(CRON_ACTION);
  }

  const memoryRules = config.memoryConnected ? MEMORY_RULES_CONNECTED : MEMORY_RULES_DISABLED;

  const sections = [
    PLATFORM_IDENTITY,
    '',
    memoryRules,
    '',
    formatAgentList(config.agents),
    '',
    ACTION_DOCS_HEADER,
    ...actions.map(formatActionDoc),
  ];

  return `<system-context>\n${sections.join('\n')}\n</system-context>`;
}
