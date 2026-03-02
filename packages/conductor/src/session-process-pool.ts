import type { BackendProcess, BackendSpawnConfig, CLIBackend } from '@autonomy/agent-manager';
import { getErrorDetail, Logger } from '@autonomy/shared';

const logger = new Logger({ context: { source: 'session-process-pool' } });

/**
 * Manages per-session backend processes with LRU eviction.
 * Extracted from the Conductor to keep session lifecycle separate from orchestration.
 */
export class SessionProcessPool {
  private processes = new Map<string, BackendProcess>();
  private configOverrides = new Map<string, Record<string, string>>();

  constructor(
    private backend: CLIBackend | undefined,
    private fallbackBackend: CLIBackend | undefined,
    private systemPrompt: string,
    private maxProcesses: number = 100,
  ) {}

  /**
   * Get or create a backend process for the given sessionId.
   * Accepts optional configOverrides from message metadata to set model/flags.
   * @param backendSessionId - Stored native CLI session ID for resuming sessions
   *   across process restarts (e.g., Claude --resume, Codex exec resume).
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: LRU pool management with config override detection
  async getOrCreate(
    sessionId: string,
    configOverrides?: Record<string, string>,
    backendSessionId?: string,
  ): Promise<BackendProcess | undefined> {
    if (!this.backend) return undefined;

    // Check if config overrides changed — if so, invalidate existing process
    if (configOverrides && Object.keys(configOverrides).length > 0) {
      const lastOverrides = this.configOverrides.get(sessionId);
      const changed =
        !lastOverrides || JSON.stringify(lastOverrides) !== JSON.stringify(configOverrides);
      if (changed) {
        const existing = this.processes.get(sessionId);
        if (existing) {
          this.processes.delete(sessionId);
          existing.stop().catch((error) => {
            logger.debug('Error stopping session for config change', {
              sessionId,
              error: getErrorDetail(error),
            });
          });
        }
      }
    }

    // Check for existing session process (LRU: delete+re-insert moves to tail)
    const existing = this.processes.get(sessionId);
    if (existing?.alive) {
      this.processes.delete(sessionId);
      this.processes.set(sessionId, existing);
      return existing;
    }

    // Remove dead entry if present
    if (existing) {
      this.processes.delete(sessionId);
      this.configOverrides.delete(sessionId);
    }

    // Evict least-recently-used session if at capacity
    if (this.processes.size >= this.maxProcesses) {
      const oldest = this.processes.keys().next().value;
      if (oldest) {
        const oldProc = this.processes.get(oldest);
        this.processes.delete(oldest);
        this.configOverrides.delete(oldest);
        try {
          await oldProc?.stop();
        } catch (error) {
          logger.debug('Error stopping evicted session', {
            sessionId: oldest,
            error: getErrorDetail(error),
          });
        }
      }
    }

    // Build spawn config with config overrides.
    // skipPermissions: true is required because the conductor runs headlessly
    // (no interactive terminal for user to approve tool prompts).
    // This is consistent with Codex (--full-auto) and Gemini (--approval-mode=yolo)
    // which always auto-approve tool usage.
    const spawnConfig: BackendSpawnConfig = {
      agentId: 'conductor',
      systemPrompt: this.systemPrompt,
      skipPermissions: true,
      // Pass stored native session ID so the CLI backend can --resume it.
      ...(backendSessionId ? { sessionId: backendSessionId } : {}),
    };

    // Translate config overrides → spawn config fields
    if (configOverrides && Object.keys(configOverrides).length > 0) {
      const backendOptions = this.backend.getConfigOptions();

      for (const [optName, optValue] of Object.entries(configOverrides)) {
        if (optName === 'model') {
          spawnConfig.model = optValue;
        } else {
          // Find the CLI flag for this option
          const optDef = backendOptions.find((o) => o.name === optName);
          if (optDef) {
            if (!spawnConfig.extraFlags) spawnConfig.extraFlags = {};
            spawnConfig.extraFlags[optDef.cliFlag] = optValue;
          }
        }
      }

      this.configOverrides.set(sessionId, { ...configOverrides });
    }

    // Spawn a new stateless process for this session.
    try {
      const proc = await this.backend.spawn(spawnConfig);
      this.processes.set(sessionId, proc);
      logger.info('Session backend spawned', {
        sessionId,
        configOverrideKeys: configOverrides ? Object.keys(configOverrides) : [],
      });
      return proc;
    } catch (error) {
      logger.error('Failed to spawn session backend', {
        sessionId,
        error: getErrorDetail(error),
      });

      if (this.fallbackBackend) {
        try {
          logger.info('Trying fallback backend for session', {
            sessionId,
            fallback: this.fallbackBackend.name,
          });
          // backendSessionId intentionally not forwarded — the fallback is a different
          // CLI backend and its session format is incompatible. Starts fresh.
          const fallbackConfig = {
            agentId: 'conductor',
            systemPrompt: this.systemPrompt,
            skipPermissions: true,
          };
          const proc = await this.fallbackBackend.spawn(fallbackConfig);
          this.processes.set(sessionId, proc);
          logger.info('Session backend spawned via fallback', {
            sessionId,
            fallback: this.fallbackBackend.name,
          });
          return proc;
        } catch (fallbackError) {
          logger.error('Fallback backend also failed for session', {
            sessionId,
            error: getErrorDetail(fallbackError),
          });
        }
      }

      return undefined;
    }
  }

  /** Get the live backend process for a session (if any). */
  getProcess(sessionId: string): BackendProcess | undefined {
    const proc = this.processes.get(sessionId);
    return proc?.alive ? proc : undefined;
  }

  /** Kill the backend process for a session so it respawns with new config on next message. */
  invalidate(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc) {
      proc.stop().catch((error) => {
        logger.debug('Error stopping invalidated session backend', {
          sessionId,
          error: getErrorDetail(error),
        });
      });
      this.processes.delete(sessionId);
      this.configOverrides.delete(sessionId);
    }
  }

  /** Stop all session processes. */
  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.processes.values()].map((proc) =>
        proc.stop().catch((error) => {
          logger.debug('Error stopping session backend during shutdown', {
            error: getErrorDetail(error),
          });
        }),
      ),
    );
    this.processes.clear();
    this.configOverrides.clear();
  }
}
