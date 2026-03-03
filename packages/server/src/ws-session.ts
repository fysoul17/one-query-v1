import type { WSServerSessionInit } from '@autonomy/shared';
import { getErrorDetail, Logger, MessageRole, WSServerMessageType } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import type { SessionStore } from './session-store.ts';
import type { WSData } from './websocket.ts';
import { safeSend } from './ws-utils.ts';

const wsSessionLogger = new Logger({ context: { source: 'websocket' } });

export function ensureSession(ws: ServerWebSocket<WSData>, sessionStore?: SessionStore): void {
  if (!ws.data.sessionId && sessionStore) {
    const session = sessionStore.create({ title: 'New Chat' });
    ws.data.sessionId = session.id;
    const sessionInit: WSServerSessionInit = {
      type: WSServerMessageType.SESSION_INIT,
      sessionId: session.id,
    };
    safeSend(ws, sessionInit);
  }
}

export function persistUserMessage(
  sessionStore: SessionStore,
  sessionId: string,
  content: string,
): void {
  try {
    sessionStore.addMessage(sessionId, MessageRole.USER, content);
    const session = sessionStore.getById(sessionId);
    if (session && session.title === 'New Chat' && session.messageCount <= 1 && content) {
      const title = content.length > 60 ? `${content.slice(0, 57)}...` : content;
      sessionStore.update(sessionId, { title });
    }
  } catch (err) {
    wsSessionLogger.warn('Failed to persist user message', {
      sessionId,
      error: getErrorDetail(err),
    });
  }
}

export function persistAssistantMessage(
  sessionStore: SessionStore,
  sessionId: string,
  content: string,
  targetAgent?: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    sessionStore.addMessage(sessionId, MessageRole.ASSISTANT, content, targetAgent, metadata);
  } catch (err) {
    wsSessionLogger.warn('Failed to persist assistant message', {
      sessionId,
      error: getErrorDetail(err),
    });
  }
}
