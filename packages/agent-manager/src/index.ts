// @autonomy/agent-manager — CLI AI process lifecycle management

export { AgentPool, type AgentPoolOptions } from './agent-pool.ts';
export { AgentProcess, type AgentProcessOptions } from './agent-process.ts';
export {
  ClaudeBackend,
  CodexBackend,
  DefaultBackendRegistry,
  GeminiBackend,
  getBackend,
  PiBackend,
  registerBackend,
} from './backends/index.ts';
export type { BackendRegistry } from './backends/registry.ts';
export type { BackendProcess, BackendSpawnConfig, CLIBackend } from './backends/types.ts';
export type { StreamEvent } from '@autonomy/shared';
export {
  AgentManagerError,
  AgentNotFoundError,
  AgentStateError,
  BackendError,
  MaxAgentsReachedError,
} from './errors.ts';
