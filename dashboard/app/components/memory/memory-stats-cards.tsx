import { formatBytes } from '@pyx-memory/dashboard';
import { Card, CardContent } from '@/components/ui/card';

interface MemoryStatsCardsProps {
  stats: { totalEntries: number; vectorCount: number; storageUsedBytes: number } | null;
  graphNodeCount: number | null;
  graphEdgeCount: number | null;
}

export function MemoryStatsCards({ stats, graphNodeCount, graphEdgeCount }: MemoryStatsCardsProps) {
  // Show skeleton on initial load (no stats yet, still loading or first error).
  // The polling hook will retry within seconds, so don't flash an error immediately.
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['total', 'vectors', 'storage', 'graph'].map((id) => (
          <Card key={id} className="glass">
            <CardContent className="py-3">
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              <div className="mt-1 h-6 w-10 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    { label: 'Entries', value: String(stats.totalEntries) },
    { label: 'Vectors', value: String(stats.vectorCount) },
    { label: 'Storage', value: formatBytes(stats.storageUsedBytes) },
    {
      label: 'Graph',
      value: graphNodeCount !== null ? `${graphNodeCount}N / ${graphEdgeCount ?? 0}E` : '\u2014',
      glow: 'hover:glow-cyan',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="card-hover accent-line-top transition-all">
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="font-mono text-lg font-bold">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
