import { Header } from '@/components/layout/header';
import { UsageDashboard } from '@/components/settings/usage-dashboard';
import { getUsageSummary } from '@/lib/api-server';
import type { UsageSummary } from '@autonomy/shared';

export const dynamic = 'force-dynamic';

export default async function UsagePage() {
  let dailySummary: UsageSummary[] = [];
  let monthlySummary: UsageSummary[] = [];

  try {
    [dailySummary, monthlySummary] = await Promise.all([
      getUsageSummary('day'),
      getUsageSummary('month'),
    ]);
  } catch {
    // leave empty
  }

  return (
    <>
      <Header title="Usage" />
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-lg font-bold">Usage Analytics</h2>
          <p className="text-sm text-muted-foreground">
            API request tracking and quota monitoring
          </p>
        </div>
        <UsageDashboard daily={dailySummary} monthly={monthlySummary} />
      </div>
    </>
  );
}
