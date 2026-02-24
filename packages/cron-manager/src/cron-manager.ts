import type { Conductor } from '@autonomy/conductor';
import type {
  CronConfig,
  CronEntry,
  CronEntryWithStatus,
  CronExecutionLog,
  CronWorkflow,
} from '@autonomy/shared';
import { Logger } from '@autonomy/shared';
import { Cron } from 'croner';
import { CronNotFoundError, CronNotInitializedError, CronScheduleError } from './errors.ts';

const cronLogger = new Logger({ context: { source: 'cron-manager' } });

export interface CronManagerOptions {
  dataDir?: string;
  maxExecutionLogs?: number;
}

const DEFAULT_MAX_EXECUTION_LOGS = 200;

export class CronManager {
  private conductor: Conductor;
  private dataDir: string;
  private maxExecutionLogs: number;
  private initialized = false;
  private crons: CronEntry[] = [];
  private jobs = new Map<string, Cron>();
  private executionLogs: CronExecutionLog[] = [];
  private executing = new Set<string>();

  constructor(conductor: Conductor, options?: CronManagerOptions) {
    this.conductor = conductor;
    this.dataDir = options?.dataDir ?? 'data';
    this.maxExecutionLogs = options?.maxExecutionLogs ?? DEFAULT_MAX_EXECUTION_LOGS;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.loadConfig();

    for (const entry of this.crons) {
      if (entry.enabled) {
        this.scheduleJob(entry);
      }
    }

    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
    this.initialized = false;
  }

  list(): CronEntry[] {
    this.ensureInitialized();
    return [...this.crons];
  }

  get(id: string): CronEntry | undefined {
    this.ensureInitialized();
    return this.crons.find((c) => c.id === id);
  }

  async create(params: {
    name: string;
    schedule: string;
    timezone?: string;
    enabled?: boolean;
    workflow: CronWorkflow;
  }): Promise<CronEntry> {
    this.ensureInitialized();
    this.validateSchedule(params.schedule);

    const entry: CronEntry = {
      id: crypto.randomUUID(),
      name: params.name,
      schedule: params.schedule,
      timezone: params.timezone ?? 'UTC',
      enabled: params.enabled ?? true,
      workflow: params.workflow,
      createdBy: 'api',
      createdAt: new Date().toISOString(),
    };

    this.crons.push(entry);

    if (entry.enabled) {
      this.scheduleJob(entry);
    }

    await this.saveConfig();
    return entry;
  }

  async update(
    id: string,
    params: {
      name?: string;
      schedule?: string;
      timezone?: string;
      enabled?: boolean;
      workflow?: CronWorkflow;
    },
  ): Promise<CronEntry> {
    this.ensureInitialized();

    const index = this.crons.findIndex((c) => c.id === id);
    if (index === -1) throw new CronNotFoundError(id);

    if (params.schedule) {
      this.validateSchedule(params.schedule);
    }

    const existing = this.crons[index] as CronEntry;
    const updated: CronEntry = {
      ...existing,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.schedule !== undefined && { schedule: params.schedule }),
      ...(params.timezone !== undefined && { timezone: params.timezone }),
      ...(params.enabled !== undefined && { enabled: params.enabled }),
      ...(params.workflow !== undefined && { workflow: params.workflow }),
    };

    this.crons[index] = updated;

    // Reschedule
    this.unscheduleJob(id);
    if (updated.enabled) {
      this.scheduleJob(updated);
    }

    await this.saveConfig();
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.ensureInitialized();

    const index = this.crons.findIndex((c) => c.id === id);
    if (index === -1) throw new CronNotFoundError(id);

    this.unscheduleJob(id);
    this.crons.splice(index, 1);
    await this.saveConfig();
  }

  async trigger(id: string): Promise<CronExecutionLog> {
    this.ensureInitialized();

    const entry = this.crons.find((c) => c.id === id);
    if (!entry) throw new CronNotFoundError(id);

    return this.executeWorkflow(entry);
  }

  getExecutionLogs(cronId?: string, limit?: number): CronExecutionLog[] {
    let logs = this.executionLogs;
    if (cronId) {
      logs = logs.filter((l) => l.cronId === cronId);
    }
    if (limit) {
      logs = logs.slice(-limit);
    }
    return logs;
  }

  getNextRun(id: string): Date | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    return job.nextRun() ?? null;
  }

  getStatus(): CronEntryWithStatus[] {
    this.ensureInitialized();
    return this.crons.map((cron) => {
      const nextRun = this.getNextRun(cron.id);
      const cronLogs = this.getExecutionLogs(cron.id);
      const lastExecution = cronLogs.at(-1) ?? null;
      return {
        ...cron,
        nextRunAt: nextRun ? nextRun.toISOString() : null,
        lastExecution,
      };
    });
  }

  private scheduleJob(entry: CronEntry): void {
    const job = new Cron(entry.schedule, { timezone: entry.timezone }, () => {
      this.executeWorkflow(entry).catch((err) => {
        cronLogger.error('Scheduled execution failed', {
          cronName: entry.name,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
    this.jobs.set(entry.id, job);
  }

  private unscheduleJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  private async executeWorkflow(entry: CronEntry): Promise<CronExecutionLog> {
    // Concurrent execution guard
    if (this.executing.has(entry.id)) {
      const log: CronExecutionLog = {
        cronId: entry.id,
        executedAt: new Date().toISOString(),
        result: '',
        success: false,
        error: 'Skipped: already executing',
      };
      this.addExecutionLog(log);
      return log;
    }

    this.executing.add(entry.id);

    try {
      const results: string[] = [];

      for (const step of entry.workflow.steps) {
        const result = await this.conductor.sendToAgent(step.agentId, step.task);
        results.push(result);
      }

      const log: CronExecutionLog = {
        cronId: entry.id,
        executedAt: new Date().toISOString(),
        result: results.join('\n---\n'),
        success: true,
      };
      this.addExecutionLog(log);
      return log;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const log: CronExecutionLog = {
        cronId: entry.id,
        executedAt: new Date().toISOString(),
        result: '',
        success: false,
        error: detail,
      };
      this.addExecutionLog(log);
      return log;
    } finally {
      this.executing.delete(entry.id);
    }
  }

  private addExecutionLog(log: CronExecutionLog): void {
    this.executionLogs.push(log);
    while (this.executionLogs.length > this.maxExecutionLogs) {
      this.executionLogs.shift();
    }
  }

  private validateSchedule(schedule: string): void {
    try {
      // Validate by creating a temporary Cron instance
      const test = new Cron(schedule);
      test.stop();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new CronScheduleError(schedule, detail);
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      const path = `${this.dataDir}/crons.json`;
      const file = Bun.file(path);
      if (await file.exists()) {
        const config = (await file.json()) as CronConfig;
        this.crons = config.crons ?? [];
      }
    } catch {
      // No config file yet — start fresh
      this.crons = [];
    }
  }

  private async saveConfig(): Promise<void> {
    const config: CronConfig = {
      version: 1,
      crons: this.crons,
    };
    const path = `${this.dataDir}/crons.json`;
    await Bun.write(path, JSON.stringify(config, null, 2));
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new CronNotInitializedError();
    }
  }
}
