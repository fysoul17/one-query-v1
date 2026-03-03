import type { BackendRegistry } from '@autonomy/agent-manager';
import type { Conductor } from '@autonomy/conductor';
import type { BackendConfigOption, WSServerChunk } from '@autonomy/shared';
import { WSServerMessageType } from '@autonomy/shared';
import type { ServerWebSocket } from 'bun';
import type { WSData } from './websocket.ts';
import { safeSend } from './ws-utils.ts';

function sendSystemMessage(ws: ServerWebSocket<WSData>, content: string): void {
  const chunk: WSServerChunk = {
    type: WSServerMessageType.CHUNK,
    content,
    agentId: 'system',
  };
  safeSend(ws, chunk);
  safeSend(ws, { type: WSServerMessageType.COMPLETE });
}

/**
 * Handle slash commands (e.g., /model, /help, /config).
 * Returns true if the message was handled as a slash command.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: slash command handler with many branches
export function handleSlashCommand(
  ws: ServerWebSocket<WSData>,
  content: string,
  backendRegistry?: BackendRegistry,
  conductor?: Conductor,
): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return false;

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const value = parts.slice(1).join(' ').trim();

  if (!command) return false;

  const configOptions: BackendConfigOption[] = backendRegistry
    ? backendRegistry.getDefault().getConfigOptions()
    : [];

  if (command === 'help') {
    if (configOptions.length === 0) {
      sendSystemMessage(ws, 'No configurable options available for the current backend.');
      return true;
    }
    const lines = ['**Available commands:**', ''];
    for (const opt of configOptions) {
      const valuesStr = opt.values ? ` (${opt.values.join(', ')})` : '';
      const defaultStr = opt.defaultValue ? ` [default: ${opt.defaultValue}]` : '';
      lines.push(`- \`/${opt.name} <value>\` — ${opt.description}${valuesStr}${defaultStr}`);
    }
    lines.push('', '- `/config` — Show current session overrides');
    lines.push('- `/help` — Show this help message');
    sendSystemMessage(ws, lines.join('\n'));
    return true;
  }

  if (command === 'config') {
    const overrides = ws.data.configOverrides;
    if (!overrides || Object.keys(overrides).length === 0) {
      sendSystemMessage(ws, 'No config overrides set for this session. Using defaults.');
      return true;
    }
    const lines = ['**Current session overrides:**', ''];
    for (const [key, val] of Object.entries(overrides)) {
      lines.push(`- **${key}**: ${val}`);
    }
    sendSystemMessage(ws, lines.join('\n'));
    return true;
  }

  // Check if command matches a config option
  const option = configOptions.find((opt) => opt.name === command);
  if (!option) {
    sendSystemMessage(
      ws,
      `Unknown command \`/${command}\`. Type \`/help\` for available commands.`,
    );
    return true;
  }

  // Show current value if no argument given
  if (!value) {
    const current = ws.data.configOverrides?.[option.name] ?? option.defaultValue ?? 'not set';
    const valuesStr = option.values ? `\nValid values: ${option.values.join(', ')}` : '';
    sendSystemMessage(ws, `**${option.name}**: ${current}${valuesStr}`);
    return true;
  }

  // Defense-in-depth: reject values with control characters or excessive length before any
  // validation or persistence, even if all current options have enumerable values arrays.
  const MAX_OPTION_VALUE_LENGTH = 256;
  if (value.length > MAX_OPTION_VALUE_LENGTH) {
    sendSystemMessage(
      ws,
      `Value for **${option.name}** is too long (max ${MAX_OPTION_VALUE_LENGTH} characters).`,
    );
    return true;
  }
  if (/[\n\r\t\0]/.test(value)) {
    sendSystemMessage(
      ws,
      `Invalid value for **${option.name}**: control characters are not allowed.`,
    );
    return true;
  }

  // Validate value against known values (if enumerable)
  if (option.values && !option.values.includes(value)) {
    sendSystemMessage(
      ws,
      `Invalid value \`${value}\` for **${option.name}**. Valid values: ${option.values.join(', ')}`,
    );
    return true;
  }

  // Store the override
  if (!ws.data.configOverrides) {
    ws.data.configOverrides = {};
  }
  ws.data.configOverrides[option.name] = value;

  // Invalidate existing session backend so next message spawns with new flags
  if (conductor && ws.data.sessionId) {
    conductor.invalidateSessionBackend(ws.data.sessionId);
  }

  // COUPLING: This message format is parsed by CONFIG_CONFIRM_RE in
  // dashboard/app/components/chat/chat-interface.tsx. If this format changes,
  // the regex in the client must be updated to match.
  sendSystemMessage(ws, `**${option.name}** set to **${value}** for this session.`);
  return true;
}
