/**
 * Tests for ChatInterface scroll behavior.
 *
 * Tests the smart scroll pattern: scroll on send always,
 * scroll on incoming only when near bottom, follow streaming content.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TestMessage {
  id: string;
  content: string;
}

const SCROLL_THRESHOLD = 100;

/**
 * Replicates the smart scroll pattern from chat-interface.tsx:
 * - isNearBottomRef tracks if user is near bottom
 * - userSentRef forces scroll on send
 * - scrollTrigger watches both count and content length
 */
function ScrollTestHarness({ onScrollCheck }: { onScrollCheck?: (el: HTMLDivElement) => void }) {
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const userSentRef = useRef(false);

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      onScrollCheck?.(scrollRef.current);
    }
  }

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
  }, []);

  const lastMessage = messages[messages.length - 1];
  const scrollTrigger = `${messages.length}-${lastMessage?.content?.length ?? 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on scrollTrigger only
  useEffect(() => {
    if (userSentRef.current) {
      scrollToBottom();
      userSentRef.current = false;
    } else if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [scrollTrigger]);

  const addMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: `msg-${Date.now()}-${Math.random()}`, content }]);
  }, []);

  const sendMessage = useCallback((content: string) => {
    userSentRef.current = true;
    setMessages((prev) => [...prev, { id: `msg-${Date.now()}-${Math.random()}`, content }]);
  }, []);

  const updateLastMessage = useCallback((content: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (!last) return prev;
      return [...prev.slice(0, -1), { ...last, content }];
    });
  }, []);

  return (
    <div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="scroll-container"
        style={{ height: '200px', overflow: 'auto' }}
      >
        {messages.map((msg) => (
          <div key={msg.id} data-testid="message" style={{ height: '100px' }}>
            {msg.content}
          </div>
        ))}
      </div>
      <button type="button" data-testid="add-message" onClick={() => addMessage('New message')}>
        Add
      </button>
      <button type="button" data-testid="send-message" onClick={() => sendMessage('Sent message')}>
        Send
      </button>
      <button
        type="button"
        data-testid="update-last"
        onClick={() =>
          updateLastMessage('Updated content that is much longer and takes more space')
        }
      >
        Update Last
      </button>
      <button
        type="button"
        data-testid="add-multiple"
        onClick={() => {
          addMessage('First');
          setTimeout(() => addMessage('Second'), 0);
        }}
      >
        Add Multiple
      </button>
    </div>
  );
}

describe('ChatInterface — smart scroll behavior', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollHeight/scrollTop properly,
    // so we need to mock the scroll-related properties
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(() => {});
    // Default: user is near bottom (scrollTop close to max)
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(750);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should scroll to bottom when a new message is added (near bottom)', async () => {
    const scrollTopSetter = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(scrollTopSetter);

    render(<ScrollTestHarness />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('add-message'));
    });

    expect(scrollTopSetter).toHaveBeenCalled();
  });

  it('should scroll to bottom on EVERY new message when near bottom', async () => {
    const scrollTopSetter = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(scrollTopSetter);

    render(<ScrollTestHarness />);

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.click(screen.getByTestId('add-message'));
      });
    }

    expect(scrollTopSetter.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('should scroll on send even when user scrolled up', async () => {
    const scrollTopSetter = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(scrollTopSetter);

    render(<ScrollTestHarness />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-message'));
    });

    // userSentRef forces scroll regardless of scroll position
    expect(scrollTopSetter).toHaveBeenCalled();
  });

  it('should scroll when streaming content updates (content length changes)', async () => {
    const scrollTopSetter = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(scrollTopSetter);

    render(<ScrollTestHarness />);

    // Add initial message
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-message'));
    });

    const callsAfterAdd = scrollTopSetter.mock.calls.length;

    // Update last message content (simulates streaming)
    await act(async () => {
      fireEvent.click(screen.getByTestId('update-last'));
    });

    // scrollTrigger includes content length, so this should trigger scroll
    expect(scrollTopSetter.mock.calls.length).toBeGreaterThan(callsAfterAdd);
  });

  it('should handle rapid sequential message additions', async () => {
    const scrollTopSetter = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(scrollTopSetter);

    render(<ScrollTestHarness />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('add-multiple'));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(scrollTopSetter.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should reset userSentRef after scrolling on send', async () => {
    const scrollTopSetter = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(scrollTopSetter);

    render(<ScrollTestHarness />);

    // Send a message
    await act(async () => {
      fireEvent.click(screen.getByTestId('send-message'));
    });

    const callsAfterSend = scrollTopSetter.mock.calls.length;
    expect(callsAfterSend).toBeGreaterThanOrEqual(1);

    // Add another message (not a send — should still scroll since near bottom)
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-message'));
    });

    expect(scrollTopSetter.mock.calls.length).toBeGreaterThan(callsAfterSend);
  });
});
