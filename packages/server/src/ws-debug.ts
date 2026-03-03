import type { ConductorEvent } from '@autonomy/conductor';
import { ConductorEventType } from '@autonomy/conductor';
import type { ConductorDebugPayload, DebugEvent, WSServerConductorStatus } from '@autonomy/shared';
import { DebugEventCategory, DebugEventLevel, WSServerMessageType } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import type { DebugBus } from './debug-bus.ts';
import { makeDebugEvent } from './debug-bus.ts';
import type { WSData } from './websocket.ts';
import { safeSend } from './ws-utils.ts';

export function buildDebugPayload(event: ConductorEvent): ConductorDebugPayload | undefined {
  const debug: ConductorDebugPayload = {};
  let hasData = false;

  if (event.durationMs !== undefined) {
    debug.durationMs = event.durationMs;
    hasData = true;
  }
  if (event.memoryResults !== undefined) {
    debug.memoryResults = event.memoryResults;
    hasData = true;
  }
  // routerType is not currently emitted by ConductorEvent; field intentionally omitted
  if (event.content) {
    debug.routingReason = event.content;
    hasData = true;
  }
  if (event.decisions) {
    debug.decisions = event.decisions;
    hasData = true;
  }
  if (event.memoryQuery) {
    debug.memoryQuery = event.memoryQuery;
    hasData = true;
  }
  if (event.memoryEntryPreviews) {
    debug.memoryEntryPreviews = event.memoryEntryPreviews;
    hasData = true;
  }
  if (event.dispatchTarget) {
    debug.dispatchTarget = event.dispatchTarget;
    hasData = true;
  }
  if (event.historyTurnCount !== undefined) {
    debug.historyTurnCount = event.historyTurnCount;
    hasData = true;
  }
  if (event.historyChars !== undefined) {
    debug.historyChars = event.historyChars;
    hasData = true;
  }

  return hasData ? debug : undefined;
}

export function conductorEventToDebug(event: ConductorEvent): DebugEvent {
  const phaseMap: Record<string, string> = {
    [ConductorEventType.QUEUED]: 'Message queued',
    [ConductorEventType.DELEGATING]: 'Delegating to agent',
    [ConductorEventType.MEMORY_SEARCH]: 'Searching memory',
    [ConductorEventType.CONTEXT_INJECT]: 'Injecting conversation history',
    [ConductorEventType.MEMORY_STORE]: 'Storing conversation',
    [ConductorEventType.DELEGATION_COMPLETE]: 'Delegation complete',
    [ConductorEventType.RESPONDING]: 'Conductor responding',
  };

  return makeDebugEvent({
    category: DebugEventCategory.CONDUCTOR,
    level: DebugEventLevel.INFO,
    source: `conductor.${event.type}`,
    message: event.content ?? phaseMap[event.type] ?? event.type,
    agentId: event.agentId,
    durationMs: event.durationMs,
    data: {
      ...(event.agentName && { agentName: event.agentName }),
      ...(event.memoryResults !== undefined && { memoryResults: event.memoryResults }),
      ...(event.memoryQuery && { memoryQuery: event.memoryQuery }),
      // routerType not present on ConductorEvent
      ...(event.decisions && { decisions: event.decisions }),
      ...(event.dispatchTarget && { dispatchTarget: event.dispatchTarget }),
    },
  });
}

export function sendConductorStatus(ws: ServerWebSocket<WSData>, event: ConductorEvent): void {
  let phase: WSServerConductorStatus['phase'];
  let message: string;

  switch (event.type) {
    case ConductorEventType.QUEUED:
      phase = 'queued';
      message = event.content ?? 'Message queued...';
      break;
    case ConductorEventType.DELEGATING:
      phase = 'delegating';
      message = 'Delegating to agent...';
      break;
    case ConductorEventType.MEMORY_SEARCH:
      phase = 'memory_search';
      message = event.content ?? 'Searching memory...';
      break;
    case ConductorEventType.CONTEXT_INJECT:
      phase = 'context_inject';
      message = event.content ?? 'Loading conversation history...';
      break;
    case ConductorEventType.MEMORY_STORE:
      phase = 'memory_store';
      message = event.content ?? 'Storing conversation...';
      break;
    case ConductorEventType.DELEGATION_COMPLETE:
      phase = 'delegation_complete';
      message = event.content ?? 'Delegation complete';
      break;
    case ConductorEventType.RESPONDING:
      phase = 'responding';
      message = event.content ?? 'Conductor is responding...';
      break;
    default:
      return;
  }

  const status: WSServerConductorStatus = {
    type: WSServerMessageType.CONDUCTOR_STATUS,
    phase,
    message,
    agentName: event.agentName,
    debug: buildDebugPayload(event),
  };
  safeSend(ws, status);
}

export function emitResponseDebug(
  debugBus: DebugBus | undefined,
  agentId: string,
  targetAgent: string | undefined,
  contentLength: number,
): void {
  const isEmpty = contentLength === 0;
  debugBus?.emit(
    makeDebugEvent({
      category: DebugEventCategory.CONDUCTOR,
      level: isEmpty ? DebugEventLevel.WARN : DebugEventLevel.INFO,
      source: isEmpty ? 'conductor.empty_response' : 'conductor.response',
      message: isEmpty
        ? `Empty response from ${agentId} — possible backend failure`
        : `Response sent (${contentLength} chars) via ${agentId}`,
      agentId: targetAgent,
    }),
  );
}
