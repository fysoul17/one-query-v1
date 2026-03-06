import type { IngestEntity, IngestRelationship } from '@autonomy/shared';
import { getErrorDetail, Logger } from '@autonomy/shared';

const logger = new Logger({ context: { source: 'entity-extractor' } });

/** Max characters sent to the extraction LLM. Most entities appear early in text. */
const MAX_EXTRACTION_INPUT_CHARS = 4000;

/** Timeout for the extraction API call. */
const EXTRACTION_TIMEOUT_MS = 10_000;

const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const MAX_ENTITY_NAME_LENGTH = 200;

const VALID_ENTITY_TYPES = new Set([
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'TOOL',
  'CONCEPT',
  'EVENT',
  'PRODUCT',
  'OTHER',
]);

export interface ExtractionResult {
  entities: IngestEntity[];
  relationships: IngestRelationship[];
}

const EMPTY_EXTRACTION: ExtractionResult = { entities: [], relationships: [] };

const EXTRACTION_PROMPT = `Extract named entities and relationships from the following text. Return ONLY valid JSON matching this schema — no markdown, no explanation:

{"entities":[{"name":"...","type":"PERSON|ORGANIZATION|LOCATION|TOOL|CONCEPT|EVENT|PRODUCT|OTHER"}],"relationships":[{"source":"...","target":"...","type":"WORKS_AT|USES|LOCATED_IN|PART_OF|RELATED_TO|CREATED|MANAGES|DEPENDS_ON|..."}]}

Rules:
- Entity names should be proper nouns or specific named concepts
- Skip generic words like "user", "system", "app"
- Relationship source and target must match entity names exactly
- If no entities found, return {"entities":[],"relationships":[]}
- Keep entity types from the enum above; relationship types are freeform

Text:
`;

/** Strip markdown code fences (```json ... ```, ```JSON ... ```, ```text ... ```, etc.) that LLMs sometimes wrap around JSON. */
function stripMarkdownFencing(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  // Remove opening fence (```<lang> or ```) and closing fence (```)
  return trimmed.replace(/^```\w*\s*\n?/, '').replace(/\n?```\s*$/, '');
}

/**
 * Parse and validate the raw JSON text returned by the extraction LLM.
 * Shared between the API and backend extraction paths.
 */
function parseExtractionResponse(text: string): ExtractionResult {
  const stripped = stripMarkdownFencing(text);
  logger.info('parseExtractionResponse', {
    rawLength: text.length,
    rawPreview: text.slice(0, 200),
    strippedPreview: stripped.slice(0, 200),
  });
  const parsed = JSON.parse(stripped) as ExtractionResult;

  if (!Array.isArray(parsed.entities)) return EMPTY_EXTRACTION;

  const entities = parsed.entities.filter(
    (e): e is IngestEntity =>
      typeof e.name === 'string' &&
      typeof e.type === 'string' &&
      e.name.length > 0 &&
      e.name.length <= MAX_ENTITY_NAME_LENGTH &&
      VALID_ENTITY_TYPES.has(e.type),
  );

  const entityNames = new Set(entities.map((e) => e.name));
  const relationships = Array.isArray(parsed.relationships)
    ? parsed.relationships.filter(
        (r): r is IngestRelationship =>
          typeof r.source === 'string' &&
          typeof r.target === 'string' &&
          typeof r.type === 'string' &&
          entityNames.has(r.source) &&
          entityNames.has(r.target),
      )
    : [];

  if (entities.length > 0) {
    logger.info('Entities extracted', {
      entityCount: entities.length,
      relationshipCount: relationships.length,
    });
  }

  return { entities, relationships };
}

/** Truncate content to the extraction input limit. */
function truncateForExtraction(content: string): string {
  return content.length > MAX_EXTRACTION_INPUT_CHARS
    ? content.slice(0, MAX_EXTRACTION_INPUT_CHARS)
    : content;
}

/**
 * Extract entities via a backend send function (e.g. conductor's CLI backend).
 * This is the **default** path — no API key required.
 * Returns empty arrays on failure (non-fatal).
 */
export async function extractEntitiesViaBackend(
  content: string,
  sendFn: (msg: string) => Promise<string>,
): Promise<ExtractionResult> {
  if (content.trim().length < 20) {
    logger.info('Backend extraction skipped — content too short', { length: content.trim().length });
    return EMPTY_EXTRACTION;
  }

  const truncated = truncateForExtraction(content);
  logger.info('Backend extraction starting', { contentLength: truncated.length });

  try {
    const response = await Promise.race([
      sendFn(EXTRACTION_PROMPT + truncated),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Backend extraction timed out')), EXTRACTION_TIMEOUT_MS),
      ),
    ]);
    logger.info('Backend extraction raw response', {
      responseLength: response.length,
      responsePreview: response.slice(0, 300),
    });
    return parseExtractionResponse(response);
  } catch (error) {
    logger.warn('Entity extraction via backend failed', { error: getErrorDetail(error) });
    return EMPTY_EXTRACTION;
  }
}

/**
 * Extract entities and relationships from text using the Anthropic Messages API (direct).
 * This is the **fast-path** when an API key is available.
 * Returns empty arrays on failure (non-fatal).
 */
export async function extractEntitiesViaApi(content: string, apiKey: string): Promise<ExtractionResult> {
  if (!apiKey || content.trim().length < 20) {
    logger.info('API extraction skipped', { hasApiKey: !!apiKey, contentLength: content.trim().length });
    return EMPTY_EXTRACTION;
  }

  const truncated = truncateForExtraction(content);
  logger.info('API extraction starting', { contentLength: truncated.length });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: EXTRACTION_PROMPT + truncated }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn('Entity extraction API error', { status: response.status });
      return EMPTY_EXTRACTION;
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.[0]?.text;
    if (!text) return EMPTY_EXTRACTION;

    return parseExtractionResponse(text);
  } catch (error) {
    logger.warn('Entity extraction failed', { error: getErrorDetail(error) });
    return EMPTY_EXTRACTION;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ExtractEntitiesOptions {
  apiKey?: string;
  backendSendFn?: (msg: string) => Promise<string>;
}

/**
 * Unified extraction entry point with priority dispatch:
 *  1. Backend send function (default path, uses conductor's CLI backend)
 *  2. Direct API (fast-path optimization when an API key is set)
 *  3. Skip (empty result) when neither is available
 */
export async function extractEntities(
  content: string,
  options: ExtractEntitiesOptions,
): Promise<ExtractionResult> {
  const path = options.backendSendFn ? 'backend' : options.apiKey ? 'api' : 'none';
  logger.info('extractEntities dispatching', {
    path,
    contentLength: content.length,
    hasBackendSendFn: !!options.backendSendFn,
    hasApiKey: !!options.apiKey,
  });
  if (options.backendSendFn) return extractEntitiesViaBackend(content, options.backendSendFn);
  if (options.apiKey) return extractEntitiesViaApi(content, options.apiKey);
  logger.warn('extractEntities — no extraction path available (no backendSendFn or apiKey)');
  return EMPTY_EXTRACTION;
}
