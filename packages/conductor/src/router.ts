import type { BackendProcess } from '@autonomy/agent-manager';
import type { AgentRuntimeInfo, MemorySearchResult } from '@autonomy/shared';
import { AgentStatus } from '@autonomy/shared';
import { buildRoutingPrompt, extractJSON, validateAgentCreation } from './conductor-prompt.ts';
import { RoutingError } from './errors.ts';
import type { IncomingMessage, RouterFn, RoutingResult } from './types.ts';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function scoreAgent(agent: AgentRuntimeInfo, messageTokens: string[]): number {
  const agentTokens = tokenize(`${agent.name} ${agent.role}`);
  let score = 0;
  for (const token of messageTokens) {
    for (const agentToken of agentTokens) {
      if (agentToken.includes(token) || token.includes(agentToken)) {
        score += 1;
      }
    }
  }
  return score;
}

export const defaultRouter: RouterFn = async (
  message: IncomingMessage,
  agents: AgentRuntimeInfo[],
  _memoryContext: MemorySearchResult | null,
): Promise<RoutingResult> => {
  // If a specific agent is targeted, route directly
  if (message.targetAgentId) {
    const target = agents.find((a) => a.id === message.targetAgentId);
    if (target) {
      return {
        agentIds: [target.id],
        reason: `Direct routing to targeted agent "${target.name}"`,
      };
    }
    return {
      agentIds: [],
      reason: `Targeted agent "${message.targetAgentId}" not found`,
    };
  }

  // Filter to available agents (not stopped/error)
  const available = agents.filter(
    (a) => a.status !== AgentStatus.STOPPED && a.status !== AgentStatus.ERROR,
  );

  if (available.length === 0) {
    return {
      agentIds: [],
      reason: 'No available agents to route to',
    };
  }

  // Score agents by keyword overlap
  const messageTokens = tokenize(message.content);
  const scored = available
    .map((a) => ({ agent: a, score: scoreAgent(a, messageTokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return {
      agentIds: scored.map((s) => s.agent.id),
      reason: `Keyword routing matched ${scored.length} agent(s): ${scored.map((s) => `${s.agent.name}(${s.score})`).join(', ')}`,
    };
  }

  // Fallback: first available agent
  const fallback = available[0];
  if (!fallback) {
    return { agentIds: [], reason: 'No available agents to route to' };
  }
  return {
    agentIds: [fallback.id],
    reason: `Fallback routing to first available agent "${fallback.name}"`,
  };
};

interface AIRoutingParsed {
  agentIds?: string[];
  createAgent?: { name: string; role: string; systemPrompt: string };
  reason?: string;
}

function parseAIResponse(aiResponse: string): AIRoutingParsed | null {
  try {
    const jsonStr = extractJSON(aiResponse);
    const parsed = JSON.parse(jsonStr) as AIRoutingParsed;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    console.warn('[conductor] AI returned invalid JSON, falling back to keyword router');
    return null;
  }
}

function resolveRoutingResult(
  parsed: AIRoutingParsed,
  agents: AgentRuntimeInfo[],
): RoutingResult | null {
  const reason = typeof parsed.reason === 'string' ? parsed.reason : 'AI routing decision';

  // Handle createAgent
  if (parsed.createAgent) {
    const validated = validateAgentCreation(parsed.createAgent);
    if (validated) {
      return { agentIds: [], createAgent: validated, reason };
    }
  }

  // Handle agentIds — filter to real agents only
  const rawIds = Array.isArray(parsed.agentIds) ? parsed.agentIds : [];
  const agentIdSet = new Set(agents.map((a) => a.id));
  const validIds = rawIds.filter(
    (id): id is string => typeof id === 'string' && agentIdSet.has(id),
  );

  if (validIds.length > 0) {
    return { agentIds: validIds, reason };
  }

  return null;
}

/**
 * Creates an AI-powered router that uses a BackendProcess (e.g. claude -p)
 * to make intelligent routing decisions. Falls back to defaultRouter on failure.
 */
export function createAIRouter(backendProcess: BackendProcess): RouterFn {
  return async (
    message: IncomingMessage,
    agents: AgentRuntimeInfo[],
    memoryContext: MemorySearchResult | null,
  ): Promise<RoutingResult> => {
    // Fast path: if message targets a specific agent, use keyword router
    if (message.targetAgentId) {
      return defaultRouter(message, agents, memoryContext);
    }

    // Build prompt and call AI
    const prompt = buildRoutingPrompt(message, agents, memoryContext);

    let aiResponse: string;
    try {
      aiResponse = await backendProcess.send(prompt);
    } catch {
      return defaultRouter(message, agents, memoryContext);
    }

    const parsed = parseAIResponse(aiResponse);
    if (!parsed) {
      return defaultRouter(message, agents, memoryContext);
    }

    const result = resolveRoutingResult(parsed, agents);
    if (result) return result;

    // AI returned no valid agents and no createAgent → fallback
    return defaultRouter(message, agents, memoryContext);
  };
}

export class RouterManager {
  private router: RouterFn = defaultRouter;

  setRouter(fn: RouterFn): void {
    this.router = fn;
  }

  resetRouter(): void {
    this.router = defaultRouter;
  }

  async route(
    message: IncomingMessage,
    agents: AgentRuntimeInfo[],
    memoryContext: MemorySearchResult | null,
  ): Promise<RoutingResult> {
    try {
      return await this.router(message, agents, memoryContext);
    } catch (error) {
      throw new RoutingError(error instanceof Error ? error.message : String(error));
    }
  }
}
