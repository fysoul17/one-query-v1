// system-action-parser.ts — Parse <system-action /> self-closing XML tags from agent responses

export interface ParsedSystemAction {
  type: string;
  attributes: Record<string, string>;
}

/**
 * Regex for self-closing system-action tags.
 * Requires a `type` attribute to avoid false positives on normal XML.
 * Matches: <system-action type="..." attr="value" />
 */
const SYSTEM_ACTION_RE = /<system-action\s+([^>]*?)\s*\/>/g;

/**
 * Regex to extract individual key="value" attribute pairs.
 */
const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  for (let match = ATTR_RE.exec(raw); match !== null; match = ATTR_RE.exec(raw)) {
    // biome-ignore lint/style/noNonNullAssertion: regex groups guaranteed
    attrs[match[1]!] = match[2]!;
  }
  return attrs;
}

/**
 * Parse all `<system-action />` tags from a response string.
 * Only tags with a `type` attribute are returned (others are ignored as false positives).
 */
export function parseSystemActions(text: string): ParsedSystemAction[] {
  const actions: ParsedSystemAction[] = [];
  SYSTEM_ACTION_RE.lastIndex = 0;

  for (
    let match = SYSTEM_ACTION_RE.exec(text);
    match !== null;
    match = SYSTEM_ACTION_RE.exec(text)
  ) {
    // biome-ignore lint/style/noNonNullAssertion: regex groups guaranteed
    const attrs = parseAttributes(match[1]!);
    if (attrs.type) {
      const type = attrs.type;
      const rest = { ...attrs };
      delete rest.type;
      actions.push({ type, attributes: rest });
    }
  }

  return actions;
}

/**
 * Strip all `<system-action ... />` tags from a response string.
 * Used to clean the output before showing to the user.
 */
export function stripSystemActions(text: string): string {
  return text
    .replace(SYSTEM_ACTION_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
