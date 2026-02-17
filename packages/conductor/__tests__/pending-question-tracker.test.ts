import { describe, expect, test } from 'bun:test';
import { QuestionStatus } from '@autonomy/shared';
import { detectQuestion, PendingQuestionTracker } from '../src/pending-questions.ts';

describe('detectQuestion', () => {
  test('detects a simple question', () => {
    expect(detectQuestion('What framework do you prefer?')).toBe('What framework do you prefer?');
  });

  test('detects question at end of multi-sentence text', () => {
    const text = 'I found some results. Here is a summary. Would you like me to continue?';
    expect(detectQuestion(text)).toBe('Would you like me to continue?');
  });

  test('returns null for non-question text', () => {
    expect(detectQuestion('Here are the results.')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(detectQuestion('')).toBeNull();
  });

  test('returns null for only whitespace', () => {
    expect(detectQuestion('   ')).toBeNull();
  });

  test('ignores questions inside code blocks', () => {
    const text = '```\nWhat is this?\n```\nHere is the result.';
    expect(detectQuestion(text)).toBeNull();
  });

  test('detects question after code block', () => {
    const text = '```js\nconsole.log("hi");\n```\nShould I deploy this?';
    expect(detectQuestion(text)).toBe('Should I deploy this?');
  });

  test('returns null for code-only response', () => {
    expect(detectQuestion('```\nfoo?\n```')).toBeNull();
  });
});

describe('PendingQuestionTracker', () => {
  test('add() creates a pending question', () => {
    const tracker = new PendingQuestionTracker();
    const q = tracker.add('agent-1', 'Researcher', 'What do you think?');
    expect(q.id).toBeDefined();
    expect(q.agentId).toBe('agent-1');
    expect(q.agentName).toBe('Researcher');
    expect(q.question).toBe('What do you think?');
    expect(q.status).toBe(QuestionStatus.PENDING);
    expect(q.unrelatedMessageCount).toBe(0);
  });

  test('getAll() returns only pending questions', () => {
    const tracker = new PendingQuestionTracker();
    const q1 = tracker.add('a1', 'A1', 'Q1?');
    tracker.add('a2', 'A2', 'Q2?');
    tracker.resolve(q1.id);
    expect(tracker.getAll()).toHaveLength(1);
    expect(tracker.getAll()[0]?.question).toBe('Q2?');
  });

  test('getByAgent() filters by agent', () => {
    const tracker = new PendingQuestionTracker();
    tracker.add('agent-1', 'A1', 'Q1?');
    tracker.add('agent-2', 'A2', 'Q2?');
    tracker.add('agent-1', 'A1', 'Q3?');
    expect(tracker.getByAgent('agent-1')).toHaveLength(2);
    expect(tracker.getByAgent('agent-2')).toHaveLength(1);
    expect(tracker.getByAgent('agent-3')).toHaveLength(0);
  });

  test('resolve() marks question as answered', () => {
    const tracker = new PendingQuestionTracker();
    const q = tracker.add('a1', 'A1', 'Q?');
    const resolved = tracker.resolve(q.id);
    expect(resolved?.status).toBe(QuestionStatus.ANSWERED);
    expect(tracker.count).toBe(0);
  });

  test('resolve() returns undefined for non-existent id', () => {
    const tracker = new PendingQuestionTracker();
    expect(tracker.resolve('nope')).toBeUndefined();
  });

  test('resolve() returns undefined for already-resolved question', () => {
    const tracker = new PendingQuestionTracker();
    const q = tracker.add('a1', 'A1', 'Q?');
    tracker.resolve(q.id);
    expect(tracker.resolve(q.id)).toBeUndefined();
  });

  test('resolveByAgent() marks all pending questions for an agent as answered', () => {
    const tracker = new PendingQuestionTracker();
    tracker.add('agent-1', 'A1', 'Q1?');
    tracker.add('agent-1', 'A1', 'Q2?');
    tracker.add('agent-2', 'A2', 'Q3?');
    const resolved = tracker.resolveByAgent('agent-1');
    expect(resolved).toHaveLength(2);
    expect(tracker.count).toBe(1); // only agent-2's question remains
  });

  test('recordUnrelatedMessage() increments count on all pending questions', () => {
    const tracker = new PendingQuestionTracker();
    const q1 = tracker.add('a1', 'A1', 'Q1?');
    tracker.add('a2', 'A2', 'Q2?');
    tracker.resolve(q1.id); // resolved — should not increment
    tracker.recordUnrelatedMessage();
    // q1 is resolved, q2 is pending
    const pending = tracker.getAll();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.unrelatedMessageCount).toBe(1);
  });

  test('evictExpired() expires by message count', () => {
    const tracker = new PendingQuestionTracker(undefined, 2); // maxUnrelated=2
    tracker.add('a1', 'A1', 'Q?');
    tracker.recordUnrelatedMessage();
    tracker.recordUnrelatedMessage();
    const evicted = tracker.evictExpired();
    expect(evicted).toBe(1);
    expect(tracker.count).toBe(0);
  });

  test('evictExpired() expires by time', () => {
    const tracker = new PendingQuestionTracker(0); // expiryMs=0 → instant expiry
    tracker.add('a1', 'A1', 'Q?');
    const evicted = tracker.evictExpired();
    expect(evicted).toBe(1);
    expect(tracker.count).toBe(0);
  });

  test('evictExpired() does not expire fresh questions', () => {
    const tracker = new PendingQuestionTracker(60_000, 10);
    tracker.add('a1', 'A1', 'Q?');
    const evicted = tracker.evictExpired();
    expect(evicted).toBe(0);
    expect(tracker.count).toBe(1);
  });

  test('count returns only pending questions', () => {
    const tracker = new PendingQuestionTracker();
    tracker.add('a1', 'A1', 'Q1?');
    tracker.add('a2', 'A2', 'Q2?');
    expect(tracker.count).toBe(2);
    const firstQ = tracker.getAll()[0];
    if (firstQ) tracker.resolve(firstQ.id);
    expect(tracker.count).toBe(1);
  });

  test('clear() removes all questions', () => {
    const tracker = new PendingQuestionTracker();
    tracker.add('a1', 'A1', 'Q1?');
    tracker.add('a2', 'A2', 'Q2?');
    tracker.clear();
    expect(tracker.count).toBe(0);
    expect(tracker.getAll()).toHaveLength(0);
  });

  test('evictExpired() prunes resolved and expired entries from Map', () => {
    const tracker = new PendingQuestionTracker(60_000, 10);
    const q1 = tracker.add('a1', 'A1', 'Q1?');
    tracker.add('a2', 'A2', 'Q2?');
    tracker.add('a3', 'A3', 'Q3?');

    // Resolve q1
    tracker.resolve(q1.id);
    expect(tracker.count).toBe(2); // q2, q3 still pending

    // evictExpired should prune the resolved q1 from internal Map
    tracker.evictExpired();
    // q1 should be removed from Map, q2 and q3 still pending
    expect(tracker.count).toBe(2);

    // Verify resolved entry is truly gone (resolve returns undefined for pruned entries)
    expect(tracker.resolve(q1.id)).toBeUndefined();
  });
});
