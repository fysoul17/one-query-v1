import { MemoryType, RAGStrategy } from '@autonomy/shared';
import { BadRequestError } from './errors.ts';

const VALID_MEMORY_TYPES = new Set<string>(Object.values(MemoryType));
const VALID_RAG_STRATEGIES = new Set<string>(Object.values(RAGStrategy));

/** Graph entity types — inlined to avoid @pyx-memory/core dependency. */
export const EntityType = {
  PERSON: 'PERSON',
  ORGANIZATION: 'ORGANIZATION',
  CONCEPT: 'CONCEPT',
  TOOL: 'TOOL',
  LOCATION: 'LOCATION',
  EVENT: 'EVENT',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/** Graph relation types — inlined to avoid @pyx-memory/core dependency. */
export const RelationType = {
  USES: 'USES',
  OWNS: 'OWNS',
  DEPENDS_ON: 'DEPENDS_ON',
  RELATED_TO: 'RELATED_TO',
  CREATED_BY: 'CREATED_BY',
  PART_OF: 'PART_OF',
  IS_A: 'IS_A',
  WORKS_AT: 'WORKS_AT',
  LOCATED_IN: 'LOCATED_IN',
} as const;
export type RelationType = (typeof RelationType)[keyof typeof RelationType];

const VALID_ENTITY_TYPES = new Set<string>(Object.values(EntityType));
const VALID_RELATION_TYPES = new Set<string>(Object.values(RelationType));

export function validateMemoryType(value: string | null | undefined): MemoryType | undefined {
  if (value == null) return undefined;
  if (!VALID_MEMORY_TYPES.has(value)) {
    throw new BadRequestError(`Invalid type: must be one of ${[...VALID_MEMORY_TYPES].join(', ')}`);
  }
  return value as MemoryType;
}

export function validateRAGStrategy(value: string | null | undefined): RAGStrategy | undefined {
  if (value == null) return undefined;
  if (!VALID_RAG_STRATEGIES.has(value)) {
    throw new BadRequestError(
      `Invalid strategy: must be one of ${[...VALID_RAG_STRATEGIES].join(', ')}`,
    );
  }
  return value as RAGStrategy;
}

export function validateEntityType(value: string): (typeof EntityType)[keyof typeof EntityType] {
  if (!VALID_ENTITY_TYPES.has(value)) {
    throw new BadRequestError(
      `Invalid entity type: must be one of ${[...VALID_ENTITY_TYPES].join(', ')}`,
    );
  }
  return value as (typeof EntityType)[keyof typeof EntityType];
}

export function validateRelationType(
  value: string,
): (typeof RelationType)[keyof typeof RelationType] {
  if (!VALID_RELATION_TYPES.has(value)) {
    throw new BadRequestError(
      `Invalid relation type: must be one of ${[...VALID_RELATION_TYPES].join(', ')}`,
    );
  }
  return value as (typeof RelationType)[keyof typeof RelationType];
}

export function validatePositiveInt(
  value: string | null | undefined,
  name: string,
  defaultValue: number,
): number {
  if (value == null) return defaultValue;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new BadRequestError(`${name} must be a positive integer`);
  }
  return parsed;
}
