import type { AIBackend } from '@autonomy/shared';
import { ClaudeBackend } from './claude.ts';
import { CodexBackend } from './codex.ts';
import { GeminiBackend } from './gemini.ts';
import { OllamaBackend } from './ollama.ts';
import { PiBackend } from './pi.ts';
import { DefaultBackendRegistry } from './registry.ts';
import type { CLIBackend } from './types.ts';

// Module-level default registry (used by legacy global functions)
const defaultRegistry = new DefaultBackendRegistry('claude' as AIBackend);
defaultRegistry.register(new ClaudeBackend());
defaultRegistry.register(new CodexBackend());
defaultRegistry.register(new GeminiBackend());
defaultRegistry.register(new PiBackend());
defaultRegistry.register(new OllamaBackend());

export function registerBackend(backend: CLIBackend): void {
  defaultRegistry.register(backend);
}

export function getBackend(name: AIBackend): CLIBackend {
  return defaultRegistry.get(name);
}

export type { BackendConfigOption } from '@autonomy/shared';
export { ClaudeBackend } from './claude.ts';
export { CodexBackend } from './codex.ts';
export { GeminiBackend } from './gemini.ts';
export { OllamaBackend } from './ollama.ts';
export { PiBackend } from './pi.ts';
export { type BackendRegistry, DefaultBackendRegistry } from './registry.ts';
export type { BackendProcess, BackendSpawnConfig, CLIBackend } from './types.ts';
