import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Conductor } from '@autonomy/conductor';
import { CronManager } from '../src/cron-manager.ts';
import { CronNotFoundError, CronNotInitializedError, CronScheduleError } from '../src/errors.ts';

// Minimal mock conductor — only needs sendToAgent
class MockConductor {
  sendToAgentCalls: Array<{ agentId: string; message: string }> = [];
  shouldThrow = false;

  async sendToAgent(agentId: string, message: string): Promise<string> {
    this.sendToAgentCalls.push({ agentId, message });
    if (this.shouldThrow) throw new Error('Agent execution failed');
    return `Result from ${agentId}: ${message}`;
  }
}

describe('CronManager', () => {
  let conductor: MockConductor;
  let dataDir: string;
  let manager: CronManager;

  beforeEach(async () => {
    conductor = new MockConductor();
    dataDir = mkdtempSync(join(tmpdir(), 'cron-test-'));
    manager = new CronManager(conductor as unknown as Conductor, { dataDir });
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      rmSync(dataDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('initialization', () => {
    test('initializes successfully', () => {
      expect(manager.list()).toEqual([]);
    });

    test('initialize is idempotent', async () => {
      await manager.initialize();
      await manager.initialize();
      expect(manager.list()).toEqual([]);
    });

    test('throws CronNotInitializedError before init', () => {
      const uninit = new CronManager(conductor as unknown as Conductor, { dataDir });
      expect(() => uninit.list()).toThrow(CronNotInitializedError);
    });

    test('loads persisted crons on init', async () => {
      await manager.create({
        name: 'test-cron',
        schedule: '0 9 * * *',
        workflow: { steps: [{ agentId: 'a1', task: 'do stuff' }], output: 'last' },
      });

      await manager.shutdown();

      // Create new instance to verify persistence
      const manager2 = new CronManager(conductor as unknown as Conductor, { dataDir });
      await manager2.initialize();

      expect(manager2.list().length).toBe(1);
      expect(manager2.list()[0]?.name).toBe('test-cron');

      await manager2.shutdown();
    });

    test('handles malformed crons.json gracefully', async () => {
      const badDir = mkdtempSync(join(tmpdir(), 'cron-bad-'));
      await Bun.write(`${badDir}/crons.json`, 'not valid json{{{');

      const badManager = new CronManager(conductor as unknown as Conductor, { dataDir: badDir });
      await badManager.initialize();

      // Should start fresh instead of crashing
      expect(badManager.list()).toEqual([]);

      await badManager.shutdown();
      rmSync(badDir, { recursive: true });
    });
  });

  describe('CRUD', () => {
    test('create returns a CronEntry with generated id', async () => {
      const cron = await manager.create({
        name: 'daily-report',
        schedule: '0 9 * * *',
        timezone: 'America/New_York',
        workflow: { steps: [{ agentId: 'agent-1', task: 'Generate report' }], output: 'last' },
      });

      expect(cron.id).toBeDefined();
      expect(cron.name).toBe('daily-report');
      expect(cron.schedule).toBe('0 9 * * *');
      expect(cron.timezone).toBe('America/New_York');
      expect(cron.enabled).toBe(true);
      expect(cron.workflow.steps.length).toBe(1);
      expect(cron.createdBy).toBe('api');
      expect(cron.createdAt).toBeDefined();
    });

    test('create defaults timezone to UTC', async () => {
      const cron = await manager.create({
        name: 'test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      expect(cron.timezone).toBe('UTC');
    });

    test('create defaults enabled to true', async () => {
      const cron = await manager.create({
        name: 'test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      expect(cron.enabled).toBe(true);
    });

    test('create with enabled=false does not schedule', async () => {
      const cron = await manager.create({
        name: 'test',
        schedule: '0 * * * *',
        enabled: false,
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      expect(cron.enabled).toBe(false);
    });

    test('create throws CronScheduleError for invalid schedule', async () => {
      await expect(
        manager.create({
          name: 'bad',
          schedule: 'not-a-cron',
          workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
        }),
      ).rejects.toBeInstanceOf(CronScheduleError);
    });

    test('list returns all crons', async () => {
      await manager.create({
        name: 'c1',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });
      await manager.create({
        name: 'c2',
        schedule: '0 */2 * * *',
        workflow: { steps: [{ agentId: 'a2', task: 't2' }], output: 'last' },
      });

      expect(manager.list().length).toBe(2);
    });

    test('get returns entry by id', async () => {
      const created = await manager.create({
        name: 'findme',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      const found = manager.get(created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('findme');
    });

    test('get returns undefined for non-existent id', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    test('update modifies cron entry', async () => {
      const cron = await manager.create({
        name: 'original',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      const updated = await manager.update(cron.id, {
        name: 'renamed',
        schedule: '0 */6 * * *',
        enabled: false,
      });

      expect(updated.name).toBe('renamed');
      expect(updated.schedule).toBe('0 */6 * * *');
      expect(updated.enabled).toBe(false);
      expect(updated.id).toBe(cron.id);
    });

    test('update throws CronNotFoundError for missing id', async () => {
      await expect(manager.update('nope', { name: 'x' })).rejects.toBeInstanceOf(CronNotFoundError);
    });

    test('update throws CronScheduleError for invalid schedule', async () => {
      const cron = await manager.create({
        name: 'test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      await expect(manager.update(cron.id, { schedule: 'bad-schedule' })).rejects.toBeInstanceOf(
        CronScheduleError,
      );
    });

    test('update modifies workflow field', async () => {
      const cron = await manager.create({
        name: 'wf-test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      const newWorkflow = {
        steps: [
          { agentId: 'a2', task: 't2' },
          { agentId: 'a3', task: 't3' },
        ],
        output: 'combined',
      };

      const updated = await manager.update(cron.id, { workflow: newWorkflow });
      expect(updated.workflow.steps.length).toBe(2);
      expect(updated.workflow.steps[0]?.agentId).toBe('a2');
      expect(updated.workflow.output).toBe('combined');
    });

    test('update enabled=false unschedules job, enabled=true reschedules', async () => {
      const cron = await manager.create({
        name: 'toggle-test',
        schedule: '0 * * * *',
        enabled: true,
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      // Disable — should not throw
      const disabled = await manager.update(cron.id, { enabled: false });
      expect(disabled.enabled).toBe(false);

      // Re-enable — should not throw
      const reEnabled = await manager.update(cron.id, { enabled: true });
      expect(reEnabled.enabled).toBe(true);
    });

    test('update with empty params is a no-op', async () => {
      const cron = await manager.create({
        name: 'noop-test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      const updated = await manager.update(cron.id, {});
      expect(updated.name).toBe('noop-test');
      expect(updated.schedule).toBe('0 * * * *');
      expect(updated.id).toBe(cron.id);
    });

    test('remove deletes cron entry', async () => {
      const cron = await manager.create({
        name: 'to-delete',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      await manager.remove(cron.id);
      expect(manager.list().length).toBe(0);
      expect(manager.get(cron.id)).toBeUndefined();
    });

    test('remove throws CronNotFoundError for missing id', async () => {
      await expect(manager.remove('nope')).rejects.toBeInstanceOf(CronNotFoundError);
    });
  });

  describe('workflow execution', () => {
    test('trigger executes workflow steps', async () => {
      const cron = await manager.create({
        name: 'workflow-test',
        schedule: '0 * * * *',
        workflow: {
          steps: [
            { agentId: 'agent-1', task: 'Step 1' },
            { agentId: 'agent-2', task: 'Step 2' },
          ],
          output: 'last',
        },
      });

      const log = await manager.trigger(cron.id);

      expect(log.success).toBe(true);
      expect(log.cronId).toBe(cron.id);
      expect(log.executedAt).toBeDefined();
      expect(log.result).toContain('Result from agent-1');
      expect(log.result).toContain('Result from agent-2');
      expect(conductor.sendToAgentCalls.length).toBe(2);
    });

    test('trigger throws CronNotFoundError for missing id', async () => {
      await expect(manager.trigger('nope')).rejects.toBeInstanceOf(CronNotFoundError);
    });

    test('trigger records execution error', async () => {
      conductor.shouldThrow = true;

      const cron = await manager.create({
        name: 'fail-test',
        schedule: '0 * * * *',
        workflow: {
          steps: [{ agentId: 'agent-1', task: 'Fail' }],
          output: 'last',
        },
      });

      const log = await manager.trigger(cron.id);
      expect(log.success).toBe(false);
      expect(log.error).toBe('Agent execution failed');
    });

    test('trigger works on disabled cron (manual trigger)', async () => {
      const cron = await manager.create({
        name: 'disabled-trigger',
        schedule: '0 * * * *',
        enabled: false,
        workflow: {
          steps: [{ agentId: 'agent-1', task: 'Run manually' }],
          output: 'last',
        },
      });

      const log = await manager.trigger(cron.id);
      expect(log.success).toBe(true);
      expect(log.result).toContain('Result from agent-1');
    });

    test('concurrent execution guard skips duplicate runs', async () => {
      // We can test this by simulating a slow execution
      const slowConductor = new MockConductor();
      const slowManager = new CronManager(slowConductor as unknown as Conductor, {
        dataDir: mkdtempSync(join(tmpdir(), 'cron-slow-')),
      });
      await slowManager.initialize();

      // Override sendToAgent to be slow
      slowConductor.sendToAgent = async (agentId: string, _message: string) => {
        await new Promise((r) => setTimeout(r, 100));
        return `Result from ${agentId}`;
      };

      const cron = await slowManager.create({
        name: 'slow',
        schedule: '0 * * * *',
        workflow: {
          steps: [{ agentId: 'a1', task: 't1' }],
          output: 'last',
        },
      });

      // Trigger concurrently
      const [log1, log2] = await Promise.all([
        slowManager.trigger(cron.id),
        slowManager.trigger(cron.id),
      ]);

      // One should succeed, the other should be skipped
      const results = [log1, log2];
      const skipped = results.find((r) => r.error === 'Skipped: already executing');
      const succeeded = results.find((r) => r.success);

      expect(skipped).toBeDefined();
      expect(succeeded).toBeDefined();

      await slowManager.shutdown();
    });
  });

  describe('execution logs', () => {
    test('getExecutionLogs returns logs after trigger', async () => {
      const cron = await manager.create({
        name: 'log-test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      await manager.trigger(cron.id);
      await manager.trigger(cron.id);

      const logs = manager.getExecutionLogs();
      expect(logs.length).toBe(2);
    });

    test('getExecutionLogs filters by cronId', async () => {
      const c1 = await manager.create({
        name: 'c1',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });
      const c2 = await manager.create({
        name: 'c2',
        schedule: '0 */2 * * *',
        workflow: { steps: [{ agentId: 'a2', task: 't2' }], output: 'last' },
      });

      await manager.trigger(c1.id);
      await manager.trigger(c2.id);
      await manager.trigger(c1.id);

      const logs = manager.getExecutionLogs(c1.id);
      expect(logs.length).toBe(2);
      expect(logs.every((l) => l.cronId === c1.id)).toBe(true);
    });

    test('getExecutionLogs respects limit', async () => {
      const cron = await manager.create({
        name: 'limit-test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      await manager.trigger(cron.id);
      await manager.trigger(cron.id);
      await manager.trigger(cron.id);

      const logs = manager.getExecutionLogs(undefined, 2);
      expect(logs.length).toBe(2);
    });

    test('execution logs are trimmed at maxExecutionLogs', async () => {
      const smallManager = new CronManager(conductor as unknown as Conductor, {
        dataDir: mkdtempSync(join(tmpdir(), 'cron-trim-')),
        maxExecutionLogs: 3,
      });
      await smallManager.initialize();

      const cron = await smallManager.create({
        name: 'trim-test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      for (let i = 0; i < 5; i++) {
        await smallManager.trigger(cron.id);
      }

      expect(smallManager.getExecutionLogs().length).toBe(3);

      await smallManager.shutdown();
    });
  });

  describe('getNextRun', () => {
    test('returns Date for enabled cron with scheduled job', async () => {
      const cron = await manager.create({
        name: 'next-run-test',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      const nextRun = manager.getNextRun(cron.id);
      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun?.getTime()).toBeGreaterThan(Date.now());
    });

    test('returns null for disabled cron (no scheduled job)', async () => {
      const cron = await manager.create({
        name: 'disabled-next',
        schedule: '0 * * * *',
        enabled: false,
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      const nextRun = manager.getNextRun(cron.id);
      expect(nextRun).toBeNull();
    });

    test('returns null for non-existent id', () => {
      expect(manager.getNextRun('nonexistent')).toBeNull();
    });
  });

  describe('getStatus', () => {
    test('returns enriched entries with nextRunAt', async () => {
      await manager.create({
        name: 'status-enabled',
        schedule: '0 * * * *',
        enabled: true,
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });
      await manager.create({
        name: 'status-disabled',
        schedule: '0 */2 * * *',
        enabled: false,
        workflow: { steps: [{ agentId: 'a2', task: 't2' }], output: 'last' },
      });

      const status = manager.getStatus();
      expect(status.length).toBe(2);

      const enabled = status.find((s) => s.name === 'status-enabled');
      const disabled = status.find((s) => s.name === 'status-disabled');

      expect(enabled?.nextRunAt).toBeDefined();
      expect(enabled?.nextRunAt).not.toBeNull();
      expect(disabled?.nextRunAt).toBeNull();
    });

    test('includes lastExecution when logs exist', async () => {
      const cron = await manager.create({
        name: 'status-logs',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      // Before trigger — no lastExecution
      let status = manager.getStatus();
      expect(status[0]?.lastExecution).toBeNull();

      // After trigger — has lastExecution
      await manager.trigger(cron.id);
      status = manager.getStatus();
      expect(status[0]?.lastExecution).toBeDefined();
      expect(status[0]?.lastExecution?.success).toBe(true);
      expect(status[0]?.lastExecution?.cronId).toBe(cron.id);
    });

    test('lastExecution shows most recent log', async () => {
      conductor.shouldThrow = false;
      const cron = await manager.create({
        name: 'multi-exec',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      await manager.trigger(cron.id);

      // Second trigger fails
      conductor.shouldThrow = true;
      await manager.trigger(cron.id);

      const status = manager.getStatus();
      expect(status[0]?.lastExecution?.success).toBe(false);
    });
  });

  describe('shutdown', () => {
    test('shutdown stops all jobs', async () => {
      await manager.create({
        name: 'c1',
        schedule: '0 * * * *',
        workflow: { steps: [{ agentId: 'a1', task: 't1' }], output: 'last' },
      });

      await manager.shutdown();

      // After shutdown, list should throw not initialized
      expect(() => manager.list()).toThrow(CronNotInitializedError);
    });
  });
});
