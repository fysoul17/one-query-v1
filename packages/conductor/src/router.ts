import type { AgentRuntimeInfo, MemorySearchResult } from '@autonomy/shared';
import { AgentStatus } from '@autonomy/shared';
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
