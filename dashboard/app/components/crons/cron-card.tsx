import type { CronEntryWithStatus } from '@autonomy/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import { CronCardActions } from './cron-card-actions';

export function CronCard({ cron }: { cron: CronEntryWithStatus }) {
  return (
    <Card className={`card-hover accent-line-top transition-all`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-bold text-foreground">{cron.name}</h3>
          <p className="truncate font-mono text-xs text-muted-foreground">{cron.schedule}</p>
        </div>
        <CronCardActions cron={cron} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={cron.enabled ? 'default' : 'secondary'}>
            {cron.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            {cron.timezone}
          </Badge>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            {cron.workflow.steps.length} step{cron.workflow.steps.length !== 1 ? 's' : ''}
          </div>
          {cron.nextRunAt && (
            <div className="flex items-center gap-1">
              <span className="text-neon-cyan">Next:</span>
              <span>{formatRelativeTime(cron.nextRunAt)}</span>
            </div>
          )}
          {cron.lastExecution && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Last:</span>
              <Badge
                variant={cron.lastExecution.success ? 'default' : 'destructive'}
                className="h-4 px-1 text-[9px]"
              >
                {cron.lastExecution.success ? 'OK' : 'FAIL'}
              </Badge>
              <span>{formatRelativeTime(cron.lastExecution.executedAt)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono">{cron.id.slice(0, 8)}...</span>
          <span>{formatRelativeTime(cron.createdAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
