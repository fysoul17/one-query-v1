import type { AgentRuntimeInfo, MemorySearchResult } from '@autonomy/shared';
import { buildSystemContextPreamble } from './system-context.ts';
import type { IncomingMessage } from './types.ts';

/**
 * Build the final memory-augmented prompt.
 * Layers on RAG memory context and system context preamble.
 */
export function buildMemoryAugmentedPrompt(
  message: IncomingMessage,
  memoryContext: MemorySearchResult | null,
  agents: AgentRuntimeInfo[],
  cronEnabled: boolean,
  memoryConnected: boolean,
): string {
  let prompt = message.content;

  // Conversation history is no longer injected here — native session resume
  // in each CLI backend (Claude --resume, Codex exec resume, Gemini --resume,
  // Pi RPC mode) handles multi-turn context natively.

  // Layer on RAG memory (long-term knowledge across sessions).
  if (memoryContext && memoryContext.entries.length > 0) {
    const contextSnippet = memoryContext.entries
      .slice(0, 3)
      .map((e) => e.content)
      .join('\n---\n');
    prompt = `<memory-context>\n${contextSnippet}\n</memory-context>\n\n${prompt}`;
  }

  // Prepend system context preamble (platform identity, agent list, available actions).
  const systemContext = buildSystemContextPreamble({
    agents,
    cronEnabled,
    memoryConnected,
  });
  prompt = `${systemContext}\n\n${prompt}`;

  return prompt;
}
