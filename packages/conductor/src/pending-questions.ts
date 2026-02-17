import { type PendingQuestion, QuestionStatus } from '@autonomy/shared';
import { nanoid } from 'nanoid';

const DEFAULT_EXPIRY_MS = 1_800_000; // 30 minutes
const DEFAULT_MAX_UNRELATED = 3;

/**
 * Detects whether an agent response ends with a question.
 * Extracts the last non-code-block sentence; returns it if it ends with "?".
 */
export function detectQuestion(response: string): string | null {
  if (!response || response.trim().length === 0) return null;

  // Strip code blocks (```...```)
  const withoutCodeBlocks = response.replace(/```[\s\S]*?```/g, '');
  const trimmed = withoutCodeBlocks.trim();
  if (trimmed.length === 0) return null;

  // Split into sentences (rough: split on . ! ? followed by whitespace or end)
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1]?.trim();
  if (!last) return null;

  // Check if it ends with a question mark
  if (last.endsWith('?')) {
    return last;
  }

  return null;
}

/**
 * Tracks pending questions from agents that need follow-up answers.
 * Follows the ActivityLog pattern: self-contained class with private state.
 *
 * Expiry is hybrid (per ARCHITECTURE-V2.md):
 * - Time-based: question older than expiryMs
 * - Message-count: unrelatedMessageCount >= maxUnrelated
 */
export class PendingQuestionTracker {
  private questions = new Map<string, PendingQuestion>();
  private expiryMs: number;
  private maxUnrelated: number;

  constructor(expiryMs?: number, maxUnrelated?: number) {
    this.expiryMs = expiryMs ?? DEFAULT_EXPIRY_MS;
    this.maxUnrelated = maxUnrelated ?? DEFAULT_MAX_UNRELATED;
  }

  add(agentId: string, agentName: string, question: string): PendingQuestion {
    const pq: PendingQuestion = {
      id: nanoid(),
      agentId,
      agentName,
      question,
      createdAt: new Date().toISOString(),
      status: QuestionStatus.PENDING,
      unrelatedMessageCount: 0,
    };
    this.questions.set(pq.id, pq);
    return pq;
  }

  getAll(): PendingQuestion[] {
    return [...this.questions.values()].filter((q) => q.status === QuestionStatus.PENDING);
  }

  getByAgent(agentId: string): PendingQuestion[] {
    return this.getAll().filter((q) => q.agentId === agentId);
  }

  resolve(questionId: string): PendingQuestion | undefined {
    const q = this.questions.get(questionId);
    if (!q || q.status !== QuestionStatus.PENDING) return undefined;
    q.status = QuestionStatus.ANSWERED;
    return q;
  }

  /**
   * Resolve all pending questions for a given agent (when message routes back to that agent).
   * Returns the resolved questions.
   */
  resolveByAgent(agentId: string): PendingQuestion[] {
    const resolved: PendingQuestion[] = [];
    for (const q of this.questions.values()) {
      if (q.agentId === agentId && q.status === QuestionStatus.PENDING) {
        q.status = QuestionStatus.ANSWERED;
        resolved.push(q);
      }
    }
    return resolved;
  }

  recordUnrelatedMessage(): void {
    for (const q of this.questions.values()) {
      if (q.status === QuestionStatus.PENDING) {
        q.unrelatedMessageCount++;
      }
    }
  }

  /**
   * Evict questions that have expired by time or message count.
   * Also prunes resolved/expired entries from the Map to prevent memory leaks.
   * Returns the number of newly evicted questions.
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    const toDelete: string[] = [];

    for (const [id, q] of this.questions.entries()) {
      // Prune already-resolved or already-expired entries
      if (q.status === QuestionStatus.ANSWERED || q.status === QuestionStatus.EXPIRED) {
        toDelete.push(id);
        continue;
      }

      const age = now - new Date(q.createdAt).getTime();
      const expiredByTime = age >= this.expiryMs;
      const expiredByCount = q.unrelatedMessageCount >= this.maxUnrelated;

      if (expiredByTime || expiredByCount) {
        q.status = QuestionStatus.EXPIRED;
        toDelete.push(id);
        evicted++;
      }
    }

    for (const id of toDelete) {
      this.questions.delete(id);
    }

    return evicted;
  }

  get count(): number {
    return this.getAll().length;
  }

  clear(): void {
    this.questions.clear();
  }
}
