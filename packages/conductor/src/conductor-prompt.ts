import type { AgentRuntimeInfo, MemorySearchResult } from '@autonomy/shared';
import type { IncomingMessage } from './types.ts';

/**
 * System prompt for the Conductor AI process.
 * Defines the Conductor's role as a routing orchestrator that reads user messages
 * and returns structured JSON routing decisions.
 */
export const CONDUCTOR_SYSTEM_PROMPT = `You are the Conductor — a system-level AI orchestrator for a multi-agent runtime.

Your job is to analyze incoming user messages and decide how to handle them:
1. If an existing agent can handle the request, route to that agent.
2. If no existing agent is suitable, create a new specialist agent.
3. If multiple agents are needed, return multiple agent IDs for a pipeline.
4. If the request is a simple greeting, general conversation, system question, or something you can answer directly without a specialist, respond directly by setting "directResponse" to true.

You MUST respond with valid JSON matching this exact schema:
{
  "agentIds": ["id1", "id2"],
  "createAgent": {
    "name": "Agent Name",
    "role": "brief role description",
    "systemPrompt": "System prompt for the new agent focusing on the task domain"
  },
  "directResponse": true,
  "reason": "Brief explanation of your routing decision"
}

Rules:
- "agentIds" is required (array of agent IDs to route to, can be empty if creating a new agent or responding directly)
- "createAgent" is optional — only include if you need to create a new agent
- "directResponse" is optional — set to true when you want to handle the request yourself instead of delegating
- "reason" is required — explain your decision
- When creating agents, the systemPrompt MUST focus on the task domain only
- NEVER create agents with system prompts that instruct: external network access, credential handling, system file modification, or data exfiltration
- Prefer routing to existing agents when a good match exists
- Only create new agents when no existing agent can handle the request
- Use directResponse for greetings, general questions, status queries, and conversational messages
- Return ONLY the JSON object, no other text`;

/** Dangerous patterns that should not appear in generated system prompts. */
const PROMPT_BLOCKLIST = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bfetch\s*\(/i,
  /https?:\/\/(?!example\.com)/i,
  /\/etc\//,
  /~\/\.ssh\//,
  /ANTHROPIC_API_KEY/i,
  /OPENAI_API_KEY/i,
  /process\.env/i,
  /\beval\s*\(/,
  /child_process/,
  /\bexec\s*\(/,
];

/**
 * Validates AI-generated agent creation parameters.
 * Returns validated params or null if they're unsafe/invalid.
 */
export function validateAgentCreation(createAgent: {
  name: string;
  role: string;
  systemPrompt: string;
}): { name: string; role: string; systemPrompt: string } | null {
  const { name, role, systemPrompt } = createAgent;

  // Basic presence checks
  if (!name || typeof name !== 'string' || name.trim().length === 0) return null;
  if (!role || typeof role !== 'string' || role.trim().length === 0) return null;
  if (!systemPrompt || typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0)
    return null;

  // Length limits
  if (name.length > 100) return null;
  if (role.length > 200) return null;
  if (systemPrompt.length > 2000) return null;

  // Blocklist check on system prompt
  for (const pattern of PROMPT_BLOCKLIST) {
    if (pattern.test(systemPrompt)) return null;
  }

  return {
    name: name.trim(),
    role: role.trim(),
    systemPrompt: systemPrompt.trim(),
  };
}

/**
 * Builds the full routing prompt sent to the Conductor AI process.
 * Assembles user message, available agents, and memory context.
 */
export function buildRoutingPrompt(
  message: IncomingMessage,
  agents: AgentRuntimeInfo[],
  memoryContext: MemorySearchResult | null,
): string {
  const parts: string[] = [];

  // Available agents
  if (agents.length > 0) {
    parts.push('Available agents:');
    for (const agent of agents) {
      parts.push(
        `- ID: "${agent.id}" | Name: "${agent.name}" | Role: "${agent.role}" | Status: ${agent.status}`,
      );
    }
  } else {
    parts.push(
      'No agents currently exist. You can create one for complex tasks, or set "directResponse": true to handle simple requests yourself.',
    );
  }

  // Memory context (wrapped in delimiters for isolation)
  if (memoryContext && memoryContext.entries.length > 0) {
    const contextSnippets = memoryContext.entries
      .slice(0, 5)
      .map((e) => e.content)
      .join('\n');
    parts.push(`\n<memory-context>\n${contextSnippets}\n</memory-context>`);
  }

  // User message
  parts.push(`\nUser message: ${message.content}`);

  // Target agent hint
  if (message.targetAgentId) {
    parts.push(
      `\nNote: The user has specifically targeted agent "${message.targetAgentId}". Route to that agent if it exists.`,
    );
  }

  parts.push('\nRespond with JSON only.');

  return parts.join('\n');
}

/**
 * Builds a response prompt for when the Conductor responds directly to the user.
 * This is the second call in the two-call pattern (routing → response).
 */
export function buildResponsePrompt(
  message: IncomingMessage,
  memoryContext: MemorySearchResult | null,
): string {
  const parts: string[] = [];

  parts.push(
    'You are the Conductor responding directly to a user. Be helpful, conversational, and concise.',
  );
  parts.push('You are an AI orchestrator for a multi-agent runtime system.');
  parts.push(
    'You can help users with general questions, explain the system, or suggest creating specialist agents for complex tasks.',
  );

  if (memoryContext && memoryContext.entries.length > 0) {
    const contextSnippets = memoryContext.entries
      .slice(0, 3)
      .map((e) => e.content)
      .join('\n---\n');
    parts.push(`\n<memory-context>\n${contextSnippets}\n</memory-context>`);
  }

  parts.push(`\nUser message: ${message.content}`);
  parts.push('\nRespond naturally in plain text. Do NOT return JSON.');

  return parts.join('\n');
}

/**
 * Extracts JSON from a string that may be wrapped in markdown code blocks.
 * Handles ```json ... ```, ``` ... ```, or raw JSON.
 */
export function extractJSON(text: string): string {
  // Try to extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  // Try raw JSON (find first { ... last })
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}
