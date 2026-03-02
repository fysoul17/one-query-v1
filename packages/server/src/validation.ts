import { MemoryType, RAGStrategy } from '@autonomy/shared';
import { BadRequestError } from './errors.ts';

const VALID_MEMORY_TYPES = new Set<string>(Object.values(MemoryType));
const VALID_RAG_STRATEGIES = new Set<string>(Object.values(RAGStrategy));

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
