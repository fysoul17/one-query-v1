import type { CronEntryWithStatus } from '@autonomy/shared';
import { CronCard } from './cron-card';

interface CronListProps {
  crons: CronEntryWithStatus[];
}

export function CronList({ crons }: CronListProps) {
  if (crons.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No cron jobs configured. Create one to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {crons.map((cron) => (
        <CronCard key={cron.id} cron={cron} />
      ))}
    </div>
  );
}
