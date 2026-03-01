/** Badge variant for memory entry type badges. */
export function memoryTypeBadgeVariant(type: string): 'secondary' | 'outline' | 'default' {
  if (type === 'short-term' || type === 'working') return 'secondary';
  if (type === 'summary') return 'outline';
  return 'default';
}
