// system-action-executor.ts — Execute parsed system actions using Conductor/Memory/CronManager APIs

import type { Conductor } from './conductor.ts';
import type { ParsedSystemAction } from './system-action-parser.ts';

/** Minimal CronManager interface to avoid importing the full package (prevents circular deps). */
export interface CronManagerLike {
  create(params: {
    name: string;
    schedule: string;
    workflow: { steps: Array<{ agentId: string; task: string }>; output: string };
  }): Promise<{ id: string; name: string }>;
}

export interface SystemActionResult {
  type: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface ExecutorDeps {
  conductor: Conductor;
  cronManager?: CronManagerLike;
}

type ActionHandler = (
  attrs: Record<string, string>,
  deps: ExecutorDeps,
) => Promise<SystemActionResult>;

const handlers: Record<string, ActionHandler> = {
  create_agent: async (attrs, deps) => {
    const { name, role, systemPrompt } = attrs;
    if (!name || !role || !systemPrompt) {
      return {
        type: 'create_agent',
        success: false,
        error: 'Missing required attributes: name, role, systemPrompt',
      };
    }
    try {
      const info = await deps.conductor.createAgent({ name, role, systemPrompt });
      return { type: 'create_agent', success: true, data: { id: info.id, name: info.name } };
    } catch (err) {
      return {
        type: 'create_agent',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  search_memory: async (attrs, deps) => {
    const { query } = attrs;
    if (!query) {
      return { type: 'search_memory', success: false, error: 'Missing required attribute: query' };
    }
    try {
      const limit = attrs.limit ? Number.parseInt(attrs.limit, 10) : 5;
      const results = await deps.conductor.searchMemory(query, limit);
      return { type: 'search_memory', success: true, data: results };
    } catch (err) {
      return {
        type: 'search_memory',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  create_cron: async (attrs, deps) => {
    const { name, schedule, agentId, task } = attrs;
    if (!name || !schedule || !agentId || !task) {
      return {
        type: 'create_cron',
        success: false,
        error: 'Missing required attributes: name, schedule, agentId, task',
      };
    }
    if (!deps.cronManager) {
      return { type: 'create_cron', success: false, error: 'CronManager is not available' };
    }
    try {
      const entry = await deps.cronManager.create({
        name,
        schedule,
        workflow: { steps: [{ agentId, task }], output: 'last' },
      });
      return { type: 'create_cron', success: true, data: { id: entry.id, name: entry.name } };
    } catch (err) {
      return {
        type: 'create_cron',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Execute a list of parsed system actions and return results.
 */
export async function executeSystemActions(
  actions: ParsedSystemAction[],
  deps: ExecutorDeps,
): Promise<SystemActionResult[]> {
  const results: SystemActionResult[] = [];

  for (const action of actions) {
    const handler = handlers[action.type];
    if (handler) {
      const result = await handler(action.attributes, deps);
      results.push(result);
    } else {
      results.push({
        type: action.type,
        success: false,
        error: `Unknown action type: ${action.type}`,
      });
    }
  }

  return results;
}

/**
 * Format action results as a <system-action-results> XML block.
 */
export function formatActionResults(results: SystemActionResult[]): string {
  if (results.length === 0) return '';

  const lines = results.map((r) => {
    if (r.success) {
      return `  <result type="${r.type}" success="true">${JSON.stringify(r.data)}</result>`;
    }
    const safeError = (r.error ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `  <result type="${r.type}" success="false" error="${safeError}" />`;
  });

  return `\n<system-action-results>\n${lines.join('\n')}\n</system-action-results>`;
}
