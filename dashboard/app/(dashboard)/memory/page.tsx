import { Header } from '@/components/layout/header';
import { MemoryBrowser } from '@/components/memory/memory-browser';
import { MemoryStatsCards } from '@/components/memory/memory-stats-cards';
import { getGraphEdges, getMemoryEntries, getMemoryStats } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function MemoryPage() {
  let stats = null;
  let graphStats = null;
  let entries: Awaited<ReturnType<typeof getMemoryEntries>> = {
    entries: [],
    page: 1,
    limit: 20,
    totalCount: 0,
  };

  try {
    [stats, entries, graphStats] = await Promise.all([
      getMemoryStats().catch(() => null),
      getMemoryEntries(1, 20).catch(() => ({
        entries: [],
        page: 1,
        limit: 20,
        totalCount: 0,
      })),
      getGraphEdges()
        .then((r) => r.stats)
        .catch(() => null),
    ]);
  } catch {
    // Graceful fallback
  }

  return (
    <>
      <Header title="Memory" />
      <div className="space-y-6 p-6">
        <MemoryStatsCards stats={stats} graphStats={graphStats} />
        <MemoryBrowser initialEntries={entries.entries} />
      </div>
    </>
  );
}
