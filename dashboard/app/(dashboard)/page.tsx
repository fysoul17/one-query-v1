import { GettingStarted } from '@/components/home/getting-started';
import { LiveStatusCards } from '@/components/home/live-status-cards';
import { RecentActivity } from '@/components/home/recent-activity';
import { RuntimeOffline } from '@/components/home/runtime-offline';
import { Header } from '@/components/layout/header';
import { getActivity, getBackendStatus, getHealth, getMemoryStats } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  try {
    const [health, activity, memoryStats, backendStatus] = await Promise.all([
      getHealth(),
      getActivity(5).catch((err) => {
        console.error('[Home] Failed to load activity:', err);
        return [];
      }),
      getMemoryStats().catch((err) => {
        console.error('[Home] Failed to load memory stats:', err);
        return null;
      }),
      getBackendStatus().catch((err) => {
        console.error('[Home] Failed to load backend status:', err);
        return null;
      }),
    ]);

    return (
      <>
        <Header title="Home" />
        <div className="space-y-6 p-6">
          <LiveStatusCards initialHealth={health} initialMemoryStats={memoryStats} />
          {backendStatus && (
            <GettingStarted
              health={health}
              memoryStats={memoryStats}
              backends={backendStatus.backends}
            />
          )}
          <RecentActivity entries={activity} />
        </div>
      </>
    );
  } catch {
    return (
      <>
        <Header title="Home" />
        <div className="p-6">
          <RuntimeOffline />
        </div>
      </>
    );
  }
}
