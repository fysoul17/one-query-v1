import { CreateCronDialog } from '@/components/crons/create-cron-dialog';
import { CronList } from '@/components/crons/cron-list';
import { Header } from '@/components/layout/header';
import { getCrons } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AutomationPage() {
  let crons: Awaited<ReturnType<typeof getCrons>> = [];
  try {
    crons = await getCrons();
  } catch {
    crons = [];
  }

  return (
    <>
      <Header title="Automation" />
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Scheduled Tasks</h2>
            <p className="text-sm text-muted-foreground">
              {crons.length} cron job{crons.length !== 1 ? 's' : ''} configured
            </p>
          </div>
          <CreateCronDialog />
        </div>
        <CronList crons={crons} />
      </div>
    </>
  );
}
