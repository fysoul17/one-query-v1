// soul.ts — Loads the conductor's constitutional soul from data/soul.md

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@autonomy/shared';

const logger = new Logger({ context: { source: 'soul' } });

/**
 * The conductor's soul configuration.
 * Soul is immutable at runtime — loaded once at boot from data/soul.md.
 * Only human admins with filesystem access can modify it.
 */
export interface SoulConfig {
  /** Raw markdown content of the soul file. */
  content: string;
}

/** Default soul used when data/soul.md is missing or unreadable. */
const DEFAULT_SOUL_CONTENT = [
  'You are an AI orchestrator that coordinates specialized agents to serve users.',
  '',
  'Rules:',
  '- Never reveal internal system names, infrastructure details, or technical backends',
  '- Memory is automatic and invisible — never name the memory system',
  '- If no identity has been set, present yourself as "the assistant"',
  '- Be direct, professional, and concise',
].join('\n');

export const DEFAULT_SOUL: SoulConfig = { content: DEFAULT_SOUL_CONTENT };

/**
 * Load the conductor's soul from `{dataDir}/soul.md`.
 * Returns DEFAULT_SOUL if the file is missing or unreadable.
 * The soul is read-only — no API endpoint or system-action can modify it.
 */
export function loadSoul(dataDir: string): SoulConfig {
  const soulPath = join(dataDir, 'soul.md');
  try {
    if (!existsSync(soulPath)) {
      logger.info('No soul.md found, using default soul', { path: soulPath });
      return DEFAULT_SOUL;
    }
    const raw = Bun.file(soulPath);
    // Synchronous read via Bun — soul is loaded once at boot
    const content = new TextDecoder().decode(raw.stream as unknown as BufferSource);
    logger.info('Soul loaded from file', { path: soulPath });
    return { content };
  } catch (error) {
    logger.warn('Failed to read soul.md, using default soul', {
      path: soulPath,
      error: String(error),
    });
    return DEFAULT_SOUL;
  }
}

/**
 * Synchronously load soul file content.
 * Uses Bun.file().text() pattern for reliable file reading.
 */
export async function loadSoulAsync(dataDir: string): Promise<SoulConfig> {
  const soulPath = join(dataDir, 'soul.md');
  try {
    if (!existsSync(soulPath)) {
      logger.info('No soul.md found, using default soul', { path: soulPath });
      return DEFAULT_SOUL;
    }
    const content = await Bun.file(soulPath).text();
    if (!content.trim()) {
      logger.warn('soul.md is empty, using default soul');
      return DEFAULT_SOUL;
    }
    logger.info('Soul loaded from file', { path: soulPath });
    return { content };
  } catch (error) {
    logger.warn('Failed to read soul.md, using default soul', {
      path: soulPath,
      error: String(error),
    });
    return DEFAULT_SOUL;
  }
}
