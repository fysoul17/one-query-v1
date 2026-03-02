// @autonomy/agent-manager — CLI AI process lifecycle management

export { AgentPool } from './agent-pool.ts';
export {
  ClaudeBackend,
  CodexBackend,
  DefaultBackendRegistry,
  GeminiBackend,
  OllamaBackend,
  PiBackend,
} from './backends/index.ts';
export type { BackendRegistry } from './backends/registry.ts';
export type { BackendProcess, BackendSpawnConfig, CLIBackend } from './backends/types.ts';
export {
  AgentManagerError,
  AgentNotFoundError,
  AgentStateError,
  BackendError,
  MaxAgentsReachedError,
} from './errors.ts';
