import { describe, expect, test } from 'bun:test';
import {
  type ConductorIdentityConfig,
  type ConductorPersonality,
  type PendingQuestion,
  QuestionStatus,
} from '../src/types/conductor.ts';

describe('QuestionStatus', () => {
  test('has PENDING, ANSWERED, and EXPIRED values', () => {
    expect(QuestionStatus.PENDING).toBe('pending');
    expect(QuestionStatus.ANSWERED).toBe('answered');
    expect(QuestionStatus.EXPIRED).toBe('expired');
  });

  test('is a const object with exactly 3 values', () => {
    const values = Object.values(QuestionStatus);
    expect(values).toHaveLength(3);
    expect(values).toContain('pending');
    expect(values).toContain('answered');
    expect(values).toContain('expired');
  });
});

describe('PendingQuestion', () => {
  test('can be constructed with all required fields', () => {
    const q: PendingQuestion = {
      id: 'q-1',
      agentId: 'agent-1',
      agentName: 'Researcher',
      question: 'What framework do you prefer?',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: QuestionStatus.PENDING,
      unrelatedMessageCount: 0,
    };
    expect(q.id).toBe('q-1');
    expect(q.status).toBe('pending');
    expect(q.unrelatedMessageCount).toBe(0);
  });

  test('status can be answered', () => {
    const q: PendingQuestion = {
      id: 'q-2',
      agentId: 'agent-2',
      agentName: 'Coder',
      question: 'Should I use TypeScript?',
      createdAt: new Date().toISOString(),
      status: QuestionStatus.ANSWERED,
      unrelatedMessageCount: 1,
    };
    expect(q.status).toBe('answered');
  });

  test('status can be expired', () => {
    const q: PendingQuestion = {
      id: 'q-3',
      agentId: 'agent-3',
      agentName: 'Writer',
      question: 'What tone should I use?',
      createdAt: new Date().toISOString(),
      status: QuestionStatus.EXPIRED,
      unrelatedMessageCount: 5,
    };
    expect(q.status).toBe('expired');
  });
});

describe('ConductorPersonality', () => {
  test('requires only name', () => {
    const p: ConductorPersonality = { name: 'JARVIS' };
    expect(p.name).toBe('JARVIS');
    expect(p.communicationStyle).toBeUndefined();
    expect(p.traits).toBeUndefined();
  });

  test('accepts all optional fields', () => {
    const p: ConductorPersonality = {
      name: 'Friday',
      communicationStyle: 'casual',
      traits: 'Witty and resourceful, with dry humor',
    };
    expect(p.communicationStyle).toBe('casual');
    expect(p.traits).toBeDefined();
  });
});

describe('ConductorIdentityConfig', () => {
  test('can be empty', () => {
    const config: ConductorIdentityConfig = {};
    expect(config.personality).toBeUndefined();
    expect(config.sessionId).toBeUndefined();
  });

  test('accepts personality and sessionId', () => {
    const config: ConductorIdentityConfig = {
      personality: { name: 'Alfred', communicationStyle: 'formal' },
      sessionId: 'session-abc-123',
    };
    expect(config.personality?.name).toBe('Alfred');
    expect(config.sessionId).toBe('session-abc-123');
  });
});
