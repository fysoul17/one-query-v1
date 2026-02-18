import { InstanceStatus } from '@/components/home/instance-status';
import { LiveStatusCards } from '@/components/home/live-status-cards';
import { RecentActivity } from '@/components/home/recent-activity';
import { RuntimeOffline } from '@/components/home/runtime-offline';
import { Header } from '@/components/layout/header';
import { getActivity, getHealth, getInstances, getMemoryStats } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  try {
    const [health, activity, memoryStats, instances] = await Promise.all([
      getHealth(),
      getActivity(5).catch(() => []),
      getMemoryStats().catch(() => null),
      getInstances().catch(() => []),
    ]);

    return (
      <>
        <Header title="Home" />
        <div className="space-y-6 p-6">
          <LiveStatusCards initialHealth={health} initialMemoryStats={memoryStats} />
          <InstanceStatus instances={instances} />
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
