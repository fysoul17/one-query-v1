import type { CronEntry } from '@autonomy/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, Clock } from 'lucide-react';

interface ShortsCronStatusProps {
  crons: CronEntry[];
}

export function ShortsCronStatus({ crons }: ShortsCronStatusProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {crons.map((cron) => (
        <Card key={cron.id} className="border-border/40 bg-card/30">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-sm font-medium truncate">{cron.name}</p>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <code className="text-[10px] font-mono bg-muted/30 px-1.5 py-0.5 rounded">
                    {cron.schedule}
                  </code>
                  <span className="text-[10px]">{cron.timezone}</span>
                </div>
                <p className="text-[10px] text-muted-foreground/60">
                  {cron.workflow.steps.length}개 에이전트 스텝
                </p>
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] px-2 py-0.5 ${
                  cron.enabled
                    ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                    : 'text-muted-foreground border-border/40'
                }`}
              >
                {cron.enabled ? '● 활성' : '○ 비활성'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
