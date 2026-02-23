import { beforeEach, describe, expect, test } from 'bun:test';
import type { CronManager } from '@autonomy/cron-manager';
import type { CronEntry, CronEntryWithStatus, CronExecutionLog, CronWorkflow } from '@autonomy/shared';
import { BadRequestError, NotFoundError } from '../../src/errors.ts';
import { createCronRoutes } from '../../src/routes/crons.ts';

let idCounter = 0;

class MockCronManager {
  private crons: CronEntry[] = [];
  private executionLogs: CronExecutionLog[] = [];

  list(): CronEntry[] {
    return this.crons;
  }

  get(id: string): CronEntry | undefined {
    return this.crons.find((c) => c.id === id);
  }

  async create(params: {
    name: string;
    schedule: string;
    timezone?: string;
    enabled?: boolean;
    workflow: CronWorkflow;
  }): Promise<CronEntry> {
    idCounter++;
    const entry: CronEntry = {
      id: `cron-${idCounter}`,
      name: params.name,
      schedule: params.schedule,
      timezone: params.timezone ?? 'UTC',
      enabled: params.enabled ?? true,
      workflow: params.workflow,
      createdBy: 'api',
      createdAt: new Date().toISOString(),
    };
    this.crons.push(entry);
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
    const index = this.crons.findIndex((c) => c.id === id);
    if (index === -1) throw new Error(`Cron "${id}" not found`);
    const existing = this.crons[index] as CronEntry;
    const updated = { ...existing, ...params };
    this.crons[index] = updated;
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.crons = this.crons.filter((c) => c.id !== id);
  }

  async trigger(id: string): Promise<CronExecutionLog> {
    const log: CronExecutionLog = {
      cronId: id,
      executedAt: new Date().toISOString(),
      result: 'Mock execution result',
      success: true,
    };
    this.executionLogs.push(log);
    return log;
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
    const cron = this.crons.find((c) => c.id === id);
    if (cron?.enabled) return new Date(Date.now() + 3600000);
    return null;
  }

  getStatus(): CronEntryWithStatus[] {
    return this.crons.map((cron) => ({
      ...cron,
      nextRunAt: cron.enabled ? new Date(Date.now() + 3600000).toISOString() : null,
      lastExecution: this.executionLogs.filter((l) => l.cronId === cron.id).at(-1) ?? null,
    }));
  }

  addCron(overrides?: Partial<CronEntry>): CronEntry {
    idCounter++;
    const entry: CronEntry = {
      id: `cron-${idCounter}`,
      name: 'test-cron',
      schedule: '0 * * * *',
      timezone: 'UTC',
      enabled: true,
      workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      createdBy: 'api',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
    this.crons.push(entry);
    return entry;
  }
}

describe('Cron routes', () => {
  let cronManager: MockCronManager;
  let routes: ReturnType<typeof createCronRoutes>;

  beforeEach(() => {
    idCounter = 0;
    cronManager = new MockCronManager();
    routes = createCronRoutes(cronManager as unknown as CronManager);
  });

  describe('GET /api/crons (list)', () => {
    test('returns empty array when no crons', async () => {
      const res = await routes.list();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    test('returns all crons', async () => {
      cronManager.addCron({ name: 'c1' });
      cronManager.addCron({ name: 'c2' });

      const res = await routes.list();
      const body = await res.json();
      expect(body.data.length).toBe(2);
    });
  });

  describe('POST /api/crons (create)', () => {
    test('creates a cron job', async () => {
      const req = new Request('http://localhost/api/crons', {
        method: 'POST',
        body: JSON.stringify({
          name: 'daily-report',
          schedule: '0 9 * * *',
          timezone: 'America/New_York',
          workflow: { steps: [{ agentId: 'agent-1', task: 'Generate report' }], output: 'last' },
        }),
      });

      const res = await routes.create(req);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('daily-report');
      expect(body.data.schedule).toBe('0 9 * * *');
    });

    test('throws BadRequestError when name is missing', async () => {
      const req = new Request('http://localhost/api/crons', {
        method: 'POST',
        body: JSON.stringify({
          schedule: '0 * * * *',
          workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
        }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when schedule is missing', async () => {
      const req = new Request('http://localhost/api/crons', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test',
          workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
        }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when workflow is missing', async () => {
      const req = new Request('http://localhost/api/crons', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test',
          schedule: '0 * * * *',
        }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });

    test('throws BadRequestError when workflow has no steps', async () => {
      const req = new Request('http://localhost/api/crons', {
        method: 'POST',
        body: JSON.stringify({
          name: 'test',
          schedule: '0 * * * *',
          workflow: { steps: [], output: 'last' },
        }),
      });

      await expect(routes.create(req)).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('PUT /api/crons/:id (update)', () => {
    test('updates existing cron', async () => {
      const cron = cronManager.addCron({ name: 'original' });

      const req = new Request(`http://localhost/api/crons/${cron.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'renamed' }),
      });

      const res = await routes.update(req, { id: cron.id });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.name).toBe('renamed');
    });

    test('throws NotFoundError for non-existent cron', async () => {
      const req = new Request('http://localhost/api/crons/nope', {
        method: 'PUT',
        body: JSON.stringify({ name: 'x' }),
      });

      await expect(routes.update(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('DELETE /api/crons/:id (remove)', () => {
    test('deletes existing cron', async () => {
      const cron = cronManager.addCron();

      const req = new Request(`http://localhost/api/crons/${cron.id}`, { method: 'DELETE' });
      const res = await routes.remove(req, { id: cron.id });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(cron.id);
    });

    test('throws NotFoundError for non-existent cron', async () => {
      const req = new Request('http://localhost/api/crons/nope', { method: 'DELETE' });
      await expect(routes.remove(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('POST /api/crons/:id/trigger', () => {
    test('triggers existing cron', async () => {
      const cron = cronManager.addCron();

      const req = new Request(`http://localhost/api/crons/${cron.id}/trigger`, { method: 'POST' });
      const res = await routes.trigger(req, { id: cron.id });
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.cronId).toBe(cron.id);
      expect(body.data.success).toBe(true);
    });

    test('throws NotFoundError for non-existent cron', async () => {
      const req = new Request('http://localhost/api/crons/nope/trigger', { method: 'POST' });
      await expect(routes.trigger(req, { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('GET /api/crons (list with status)', () => {
    test('returns nextRunAt for enabled crons', async () => {
      cronManager.addCron({ name: 'enabled-cron', enabled: true });
      cronManager.addCron({ name: 'disabled-cron', enabled: false });

      const res = await routes.list();
      const body = await res.json();

      expect(body.data.length).toBe(2);
      const enabled = body.data.find((c: CronEntryWithStatus) => c.name === 'enabled-cron');
      const disabled = body.data.find((c: CronEntryWithStatus) => c.name === 'disabled-cron');

      expect(enabled.nextRunAt).toBeDefined();
      expect(enabled.nextRunAt).not.toBeNull();
      expect(disabled.nextRunAt).toBeNull();
    });

    test('includes lastExecution when available', async () => {
      const cron = cronManager.addCron();

      // Trigger to create an execution log
      const triggerReq = new Request(`http://localhost/api/crons/${cron.id}/trigger`, { method: 'POST' });
      await routes.trigger(triggerReq, { id: cron.id });

      const res = await routes.list();
      const body = await res.json();

      expect(body.data[0].lastExecution).toBeDefined();
      expect(body.data[0].lastExecution.success).toBe(true);
    });
  });

  describe('GET /api/crons/logs', () => {
    test('returns all logs when no filter', async () => {
      const c1 = cronManager.addCron({ name: 'c1' });
      const c2 = cronManager.addCron({ name: 'c2' });

      await cronManager.trigger(c1.id);
      await cronManager.trigger(c2.id);

      const req = new Request('http://localhost/api/crons/logs');
      const res = await routes.logs(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
    });

    test('filters by cronId', async () => {
      const c1 = cronManager.addCron({ name: 'c1' });
      const c2 = cronManager.addCron({ name: 'c2' });

      await cronManager.trigger(c1.id);
      await cronManager.trigger(c2.id);
      await cronManager.trigger(c1.id);

      const req = new Request(`http://localhost/api/crons/logs?cronId=${c1.id}`);
      const res = await routes.logs(req);
      const body = await res.json();

      expect(body.data.length).toBe(2);
      expect(body.data.every((l: CronExecutionLog) => l.cronId === c1.id)).toBe(true);
    });

    test('respects limit parameter', async () => {
      const cron = cronManager.addCron();

      await cronManager.trigger(cron.id);
      await cronManager.trigger(cron.id);
      await cronManager.trigger(cron.id);

      const req = new Request('http://localhost/api/crons/logs?limit=2');
      const res = await routes.logs(req);
      const body = await res.json();

      expect(body.data.length).toBe(2);
    });

    test('returns empty array when no logs', async () => {
      const req = new Request('http://localhost/api/crons/logs');
      const res = await routes.logs(req);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });
});
