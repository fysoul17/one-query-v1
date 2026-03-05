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

/**
 * Extract entities and relationships from text using the Anthropic Messages API.
 * Returns empty arrays on failure (non-fatal).
 */
export async function extractEntities(content: string, apiKey: string): Promise<ExtractionResult> {
  const empty: ExtractionResult = { entities: [], relationships: [] };

  if (!apiKey || content.trim().length < 20) return empty;

  const truncated =
    content.length > MAX_EXTRACTION_INPUT_CHARS
      ? content.slice(0, MAX_EXTRACTION_INPUT_CHARS)
      : content;

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
      return empty;
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.[0]?.text;
    if (!text) return empty;

    const parsed = JSON.parse(text) as ExtractionResult;

    if (!Array.isArray(parsed.entities)) return empty;

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
  } catch (error) {
    logger.warn('Entity extraction failed', { error: getErrorDetail(error) });
    return empty;
  } finally {
    clearTimeout(timeout);
  }
}
