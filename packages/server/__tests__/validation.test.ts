import { describe, expect, test } from 'bun:test';
import { MemoryType, RAGStrategy } from '@autonomy/shared';
import { BadRequestError } from '../src/errors.ts';
import { validateMemoryType, validatePositiveInt, validateRAGStrategy } from '../src/validation.ts';

describe('validateMemoryType()', () => {
  test('returns undefined for null', () => {
    expect(validateMemoryType(null)).toBeUndefined();
  });

  test('returns undefined for undefined', () => {
    expect(validateMemoryType(undefined)).toBeUndefined();
  });

  test.each([
    ['short-term', MemoryType.SHORT_TERM],
    ['long-term', MemoryType.LONG_TERM],
    ['working', MemoryType.WORKING],
    ['episodic', MemoryType.EPISODIC],
    ['summary', MemoryType.SUMMARY],
  ])('accepts valid type "%s"', (input, expected) => {
    expect(validateMemoryType(input)).toBe(expected);
  });

  test('throws BadRequestError for invalid type', () => {
    expect(() => validateMemoryType('bogus')).toThrow(BadRequestError);
  });

  test('error message lists valid types', () => {
    expect(() => validateMemoryType('invalid')).toThrow(/Invalid type/);
    expect(() => validateMemoryType('invalid')).toThrow(/long-term/);
  });
});

describe('validateRAGStrategy()', () => {
  test('returns undefined for null', () => {
    expect(validateRAGStrategy(null)).toBeUndefined();
  });

  test('returns undefined for undefined', () => {
    expect(validateRAGStrategy(undefined)).toBeUndefined();
  });

  test.each([
    ['naive', RAGStrategy.NAIVE],
    ['graph', RAGStrategy.GRAPH],
    ['agentic', RAGStrategy.AGENTIC],
    ['hybrid', RAGStrategy.HYBRID],
  ])('accepts valid strategy "%s"', (input, expected) => {
    expect(validateRAGStrategy(input)).toBe(expected);
  });

  test('throws BadRequestError for invalid strategy', () => {
    expect(() => validateRAGStrategy('bogus')).toThrow(BadRequestError);
  });

  test('error message lists valid strategies', () => {
    expect(() => validateRAGStrategy('invalid')).toThrow(/Invalid strategy/);
    expect(() => validateRAGStrategy('invalid')).toThrow(/naive/);
  });
});

describe('validatePositiveInt()', () => {
  test('returns default value for null', () => {
    expect(validatePositiveInt(null, 'page', 1)).toBe(1);
  });

  test('returns default value for undefined', () => {
    expect(validatePositiveInt(undefined, 'limit', 20)).toBe(20);
  });

  test('parses valid positive integer', () => {
    expect(validatePositiveInt('5', 'page', 1)).toBe(5);
  });

  test('parses large positive integer', () => {
    expect(validatePositiveInt('100', 'limit', 10)).toBe(100);
  });

  test('throws BadRequestError for NaN', () => {
    expect(() => validatePositiveInt('abc', 'page', 1)).toThrow(BadRequestError);
  });

  test('throws BadRequestError for negative number', () => {
    expect(() => validatePositiveInt('-1', 'page', 1)).toThrow(BadRequestError);
  });

  test('throws BadRequestError for zero', () => {
    expect(() => validatePositiveInt('0', 'page', 1)).toThrow(BadRequestError);
  });

  test('error message includes field name', () => {
    expect(() => validatePositiveInt('abc', 'limit', 10)).toThrow(/limit/);
    expect(() => validatePositiveInt('abc', 'limit', 10)).toThrow(/positive integer/);
  });
});
