import { describe, expect, test } from 'bun:test';
import * as shared from '../src/index.ts';

describe('@autonomy/shared exports', () => {
  test('module resolves without error', () => {
    expect(shared).toBeDefined();
    expect(typeof shared).toBe('object');
  });

  test('exports AgentOwner enum', () => {
    expect(shared.AgentOwner).toBeDefined();
    expect(shared.AgentOwner.USER).toBe('user');
    expect(shared.AgentOwner.CONDUCTOR).toBe('conductor');
    expect(shared.AgentOwner.SYSTEM).toBe('system');
  });

  test('exports AgentStatus enum', () => {
    expect(shared.AgentStatus).toBeDefined();
    expect(shared.AgentStatus.ACTIVE).toBe('active');
    expect(shared.AgentStatus.IDLE).toBe('idle');
    expect(shared.AgentStatus.BUSY).toBe('busy');
    expect(shared.AgentStatus.STOPPED).toBe('stopped');
    expect(shared.AgentStatus.ERROR).toBe('error');
    expect(Object.keys(shared.AgentStatus)).toHaveLength(5);
  });

  test('exports LogLevel enum', () => {
    expect(shared.LogLevel).toBeDefined();
    expect(shared.LogLevel.DEBUG).toBe('debug');
    expect(shared.LogLevel.INFO).toBe('info');
    expect(shared.LogLevel.WARN).toBe('warn');
    expect(shared.LogLevel.ERROR).toBe('error');
    expect(Object.keys(shared.LogLevel)).toHaveLength(4);
  });

  test('exports AIBackend enum', () => {
    expect(shared.AIBackend).toBeDefined();
    expect(shared.AIBackend.CLAUDE).toBe('claude');
    expect(shared.AIBackend.CODEX).toBe('codex');
    expect(shared.AIBackend.GEMINI).toBe('gemini');
  });

  test('exports MemoryType enum', () => {
    expect(shared.MemoryType).toBeDefined();
    expect(shared.MemoryType.SHORT_TERM).toBe('short-term');
    expect(shared.MemoryType.LONG_TERM).toBe('long-term');
  });

  test('exports RAGStrategy enum', () => {
    expect(shared.RAGStrategy).toBeDefined();
    expect(shared.RAGStrategy.NAIVE).toBe('naive');
  });

  test('exports VectorProvider enum', () => {
    expect(shared.VectorProvider).toBeDefined();
    expect(shared.VectorProvider.LANCEDB).toBe('lancedb');
    expect(shared.VectorProvider.QDRANT).toBe('qdrant');
  });

  test('exports RuntimeMode enum', () => {
    expect(shared.RuntimeMode).toBeDefined();
    expect(shared.RuntimeMode.STANDALONE).toBe('standalone');
    expect(shared.RuntimeMode.MANAGED).toBe('managed');
  });

  test('exports WSClientMessageType enum', () => {
    expect(shared.WSClientMessageType).toBeDefined();
    expect(shared.WSClientMessageType.MESSAGE).toBe('message');
    expect(shared.WSClientMessageType.PING).toBe('ping');
  });

  test('exports WSServerMessageType enum', () => {
    expect(shared.WSServerMessageType).toBeDefined();
    expect(shared.WSServerMessageType.CHUNK).toBe('chunk');
    expect(shared.WSServerMessageType.COMPLETE).toBe('complete');
    expect(shared.WSServerMessageType.ERROR).toBe('error');
    expect(shared.WSServerMessageType.PONG).toBe('pong');
    expect(shared.WSServerMessageType.AGENT_STATUS).toBe('agent_status');
    expect(shared.WSServerMessageType.A2A_EVENT).toBe('a2a_event');
  });

  test('exports ActivityType enum', () => {
    expect(shared.ActivityType).toBeDefined();
    expect(shared.ActivityType.MESSAGE).toBe('message');
    expect(shared.ActivityType.DELEGATION).toBe('delegation');
    expect(shared.ActivityType.AGENT_CREATED).toBe('agent_created');
    expect(shared.ActivityType.AGENT_DELETED).toBe('agent_deleted');
    expect(shared.ActivityType.CRON_EXECUTED).toBe('cron_executed');
    expect(shared.ActivityType.MEMORY_STORED).toBe('memory_stored');
    expect(shared.ActivityType.ERROR).toBe('error');
    expect(Object.keys(shared.ActivityType)).toHaveLength(7);
  });

  test('exports A2ACommunicationMode enum', () => {
    expect(shared.A2ACommunicationMode).toBeDefined();
    expect(shared.A2ACommunicationMode.DIRECT).toBe('direct');
    expect(shared.A2ACommunicationMode.RELAY).toBe('relay');
    expect(Object.keys(shared.A2ACommunicationMode)).toHaveLength(2);
  });

  test('exports DEFAULTS constants', () => {
    expect(shared.DEFAULTS).toBeDefined();
    expect(shared.DEFAULTS.PORT).toBe(7820);
    expect(shared.DEFAULTS.DATA_DIR).toBe('./data');
    expect(shared.DEFAULTS.RUNTIME_URL).toBe('http://localhost:7820');
    expect(shared.DEFAULTS.IDLE_TIMEOUT_MS).toBe(300_000);
    expect(shared.DEFAULTS.MAX_AGENTS).toBe(10);
    expect(shared.DEFAULTS.AI_BACKEND).toBe('claude');
    expect(shared.DEFAULTS.VECTOR_PROVIDER).toBe('lancedb');
    expect(shared.DEFAULTS.EMBEDDING_PROVIDER).toBe('stub');
    expect(shared.DEFAULTS.LOG_LEVEL).toBe('info');
    expect(shared.DEFAULTS.MODE).toBe('standalone');
    expect(shared.DEFAULTS.MEMORY_SERVER_PORT).toBe(7822);
    expect(shared.DEFAULTS.AUTH_ENABLED).toBe(false);
    expect(Object.keys(shared.DEFAULTS)).toHaveLength(12);
  });

  test('exports BACKEND_CAPABILITIES', () => {
    expect(shared.BACKEND_CAPABILITIES).toBeDefined();
    expect(shared.BACKEND_CAPABILITIES.claude.customTools).toBe(true);
    expect(shared.BACKEND_CAPABILITIES.codex.customTools).toBe(false);
  });

  test('exports DebugEventCategory enum', () => {
    expect(shared.DebugEventCategory).toBeDefined();
    expect(shared.DebugEventCategory.CONDUCTOR).toBe('conductor');
    expect(shared.DebugEventCategory.AGENT).toBe('agent');
    expect(shared.DebugEventCategory.MEMORY).toBe('memory');
    expect(shared.DebugEventCategory.WEBSOCKET).toBe('websocket');
    expect(shared.DebugEventCategory.SYSTEM).toBe('system');
    expect(Object.keys(shared.DebugEventCategory)).toHaveLength(5);
  });

  test('exports DebugEventLevel enum', () => {
    expect(shared.DebugEventLevel).toBeDefined();
    expect(shared.DebugEventLevel.DEBUG).toBe('debug');
    expect(shared.DebugEventLevel.INFO).toBe('info');
    expect(shared.DebugEventLevel.WARN).toBe('warn');
    expect(shared.DebugEventLevel.ERROR).toBe('error');
    expect(Object.keys(shared.DebugEventLevel)).toHaveLength(4);
  });

  test('exports DEBUG_LEVEL_ORDER constant', () => {
    expect(shared.DEBUG_LEVEL_ORDER).toBeDefined();
    expect(shared.DEBUG_LEVEL_ORDER.debug).toBe(0);
    expect(shared.DEBUG_LEVEL_ORDER.info).toBe(1);
    expect(shared.DEBUG_LEVEL_ORDER.warn).toBe(2);
    expect(shared.DEBUG_LEVEL_ORDER.error).toBe(3);
  });
});
