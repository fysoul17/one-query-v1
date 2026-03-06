import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SOUL, loadSoulAsync } from '../src/soul.ts';

describe('DEFAULT_SOUL', () => {
  test('has non-empty content', () => {
    expect(DEFAULT_SOUL.content.trim().length).toBeGreaterThan(0);
  });

  test('contains core rules', () => {
    expect(DEFAULT_SOUL.content).toContain('Never reveal internal system names');
    expect(DEFAULT_SOUL.content).toContain('Memory is automatic');
  });
});

describe('loadSoulAsync', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns content from soul.md when file exists', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'soul-test-'));
    const soulContent = '# Custom Soul\n\nYou are a test orchestrator.';
    writeFileSync(join(tempDir, 'soul.md'), soulContent);

    const result = await loadSoulAsync(tempDir);
    expect(result.content).toBe(soulContent);
  });

  test('returns DEFAULT_SOUL when soul.md does not exist', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'soul-test-'));

    const result = await loadSoulAsync(tempDir);
    expect(result).toBe(DEFAULT_SOUL);
  });

  test('returns DEFAULT_SOUL when soul.md is empty', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'soul-test-'));
    writeFileSync(join(tempDir, 'soul.md'), '');

    const result = await loadSoulAsync(tempDir);
    expect(result).toBe(DEFAULT_SOUL);
  });

  test('returns DEFAULT_SOUL when soul.md contains only whitespace', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'soul-test-'));
    writeFileSync(join(tempDir, 'soul.md'), '   \n\n  \t  ');

    const result = await loadSoulAsync(tempDir);
    expect(result).toBe(DEFAULT_SOUL);
  });

  test('returns DEFAULT_SOUL when dataDir does not exist', async () => {
    const result = await loadSoulAsync('/tmp/nonexistent-soul-dir-12345');
    expect(result).toBe(DEFAULT_SOUL);
  });
});
