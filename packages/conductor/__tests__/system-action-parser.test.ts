import { describe, expect, test } from 'bun:test';
import { parseSystemActions, stripSystemActions } from '../src/system-action-parser.ts';

describe('parseSystemActions', () => {
  test('parses a single system-action tag', () => {
    const text = 'Some text <system-action type="search_memory" query="hello" /> more text';
    const actions = parseSystemActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe('search_memory');
    expect(actions[0]?.attributes.query).toBe('hello');
  });

  test('parses multiple system-action tags', () => {
    const text = [
      '<system-action type="create_agent" name="Bot" role="helper" systemPrompt="Help" />',
      '<system-action type="search_memory" query="test" limit="3" />',
    ].join('\n');
    const actions = parseSystemActions(text);
    expect(actions).toHaveLength(2);
    expect(actions[0]?.type).toBe('create_agent');
    expect(actions[0]?.attributes.name).toBe('Bot');
    expect(actions[1]?.type).toBe('search_memory');
    expect(actions[1]?.attributes.limit).toBe('3');
  });

  test('ignores tags without a type attribute (false positive resistance)', () => {
    const text = '<system-action query="hello" />';
    const actions = parseSystemActions(text);
    expect(actions).toHaveLength(0);
  });

  test('ignores non-self-closing tags', () => {
    const text = '<system-action type="search_memory" query="hello"></system-action>';
    const actions = parseSystemActions(text);
    expect(actions).toHaveLength(0);
  });

  test('returns empty array for text with no actions', () => {
    const actions = parseSystemActions('Just regular text with <no> tags');
    expect(actions).toHaveLength(0);
  });

  test('does not include type in attributes record', () => {
    const text = '<system-action type="search_memory" query="test" />';
    const actions = parseSystemActions(text);
    expect(actions[0]?.attributes).not.toHaveProperty('type');
  });

  test('handles tags with extra whitespace', () => {
    const text = '<system-action   type="create_agent"   name="Bot"   role="test"  />';
    const actions = parseSystemActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe('create_agent');
  });
});

describe('stripSystemActions', () => {
  test('removes system-action tags from text', () => {
    const text = 'Before <system-action type="search_memory" query="x" /> after';
    const result = stripSystemActions(text);
    expect(result).toBe('Before  after');
  });

  test('collapses triple+ newlines to double', () => {
    const text = 'Before\n\n<system-action type="search_memory" query="x" />\n\nAfter';
    const result = stripSystemActions(text);
    expect(result).toBe('Before\n\nAfter');
  });

  test('returns original text when no actions present', () => {
    const text = 'Hello world';
    expect(stripSystemActions(text)).toBe('Hello world');
  });

  test('strips multiple actions', () => {
    const text = [
      'Start',
      '<system-action type="create_agent" name="A" role="r" systemPrompt="s" />',
      '<system-action type="search_memory" query="q" />',
      'End',
    ].join('\n');
    const result = stripSystemActions(text);
    expect(result).not.toContain('system-action');
    expect(result).toContain('Start');
    expect(result).toContain('End');
  });
});
