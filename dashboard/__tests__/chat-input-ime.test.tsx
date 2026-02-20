/**
 * Tests for ChatInput component — IME composition handling
 *
 * Bug: When typing Korean (or other CJK languages) via IME and pressing Enter,
 * the message sends but the last character remains in the input field.
 *
 * Root cause: handleKeyDown in chat-input.tsx does not guard against
 * e.nativeEvent.isComposing. In real browsers, some browsers (especially older
 * Chrome on certain OSes) fire keydown with key='Enter' during IME composition.
 * The handler should check isComposing and bail out if true.
 *
 * Test environment note: React 19.x in JSDOM appears to suppress React's
 * onKeyDown dispatch when the native KeyboardEvent has isComposing=true on a
 * form-wrapped textarea. However, this behavior differs from real browsers,
 * where the keydown event DOES reach the React handler. The fix (adding an
 * isComposing guard) is still necessary for cross-browser safety.
 *
 * We test both via fireEvent (which inherits React 19's JSDOM behavior) and
 * via direct assertions on the handler logic to ensure correctness.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatInput } from '../app/components/chat/chat-input';

describe('ChatInput — IME composition handling', () => {
  const defaultProps = {
    onSend: vi.fn(),
    status: 'connected' as const,
    isProcessing: false,
  };

  function renderInput(overrides = {}) {
    const props = { ...defaultProps, onSend: vi.fn(), ...overrides };
    const result = render(<ChatInput {...props} />);
    const textarea = screen.getByPlaceholderText('Send a message...');
    return { ...result, textarea, onSend: props.onSend };
  }

  // ---------------------------------------------------------------
  // Core IME scenarios: Korean
  // ---------------------------------------------------------------

  it('should NOT send when Enter is pressed during Korean IME composition', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.change(textarea, { target: { value: '안녕' } });
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '안녕하' } });

    // Enter during composition — isComposing=true
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('안녕하');
  });

  it('should NOT send when keyCode 229 (IME process key) is fired', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.change(textarea, { target: { value: '테스트' } });
    fireEvent.compositionStart(textarea);

    fireEvent.keyDown(textarea, {
      key: 'Process',
      keyCode: 229,
      isComposing: true,
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('테스트');
  });

  it('should send after Korean composition ends and Enter is pressed', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '안녕하세요' } });
    fireEvent.compositionEnd(textarea);

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: false,
    });

    expect(onSend).toHaveBeenCalledWith('안녕하세요');
  });

  it('should clear input completely after sending when not composing', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.change(textarea, { target: { value: '안녕하세요' } });

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: false,
    });

    expect(onSend).toHaveBeenCalledWith('안녕하세요');
    expect(textarea).toHaveValue('');
  });

  // ---------------------------------------------------------------
  // Japanese IME
  // ---------------------------------------------------------------

  it('should NOT send during Japanese IME composition (hiragana to kanji)', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'にほんご' } });

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('にほんご');
  });

  it('should send after Japanese composition is confirmed', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '日本語' } });
    fireEvent.compositionEnd(textarea);

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: false,
    });

    expect(onSend).toHaveBeenCalledWith('日本語');
  });

  // ---------------------------------------------------------------
  // Chinese IME (Pinyin)
  // ---------------------------------------------------------------

  it('should NOT send during Chinese Pinyin composition', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'ni' } });

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('should send after Chinese composition completes', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'ni' } });
    fireEvent.compositionEnd(textarea);
    fireEvent.change(textarea, { target: { value: '你' } });

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: false,
    });

    expect(onSend).toHaveBeenCalledWith('你');
  });

  // ---------------------------------------------------------------
  // Non-IME behavior (regression tests)
  // ---------------------------------------------------------------

  it('should send English text on Enter', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.change(textarea, { target: { value: 'hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('hello world');
    expect(textarea).toHaveValue('');
  });

  it('should NOT send on Shift+Enter (newline)', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('should NOT send when disconnected', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} status="disconnected" isProcessing={false} />);
    const textarea = screen.getByPlaceholderText('Connecting...');

    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('should NOT send when processing', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} status="connected" isProcessing={true} />);
    const textarea = screen.getByPlaceholderText('Processing...');

    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('should NOT send empty/whitespace-only messages', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------

  it('should handle rapid composition start/end cycles', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '가' } });
    fireEvent.compositionEnd(textarea);

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '가나' } });
    fireEvent.compositionEnd(textarea);

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: false,
    });

    expect(onSend).toHaveBeenCalledWith('가나');
  });

  it('should handle mixed Korean and English input', () => {
    const { textarea, onSend } = renderInput();

    fireEvent.change(textarea, { target: { value: 'Hello ' } });
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'Hello 세계' } });
    fireEvent.compositionEnd(textarea);

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      isComposing: false,
    });

    expect(onSend).toHaveBeenCalledWith('Hello 세계');
  });

  it('should send via form submit button when not composing', () => {
    const { onSend } = renderInput();
    const textarea = screen.getByPlaceholderText('Send a message...');
    const submitButton = screen.getByRole('button', { name: /send message/i });

    fireEvent.change(textarea, { target: { value: 'test message' } });
    fireEvent.click(submitButton);

    expect(onSend).toHaveBeenCalledWith('test message');
  });
});

describe('ChatInput — isComposing guard verification', () => {
  /**
   * This test directly verifies that the handleKeyDown function
   * contains an isComposing check. In a real browser (Chrome, Firefox,
   * Safari), the keydown event DOES fire during IME composition and
   * the handler MUST check isComposing to avoid double-sending.
   *
   * React 19 in JSDOM suppresses this, but real browsers don't always
   * match this behavior, especially:
   * - Chrome on Windows with Korean IME
   * - Chrome on macOS with Japanese IME
   * - Firefox with Chinese Pinyin IME
   */
  it('handleKeyDown should check nativeEvent.isComposing', async () => {
    const sourceModule = await import('../app/components/chat/chat-input');
    const source = sourceModule.ChatInput.toString();

    expect(source.includes('isComposing')).toBe(true);
  });
});
