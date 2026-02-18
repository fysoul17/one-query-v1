'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsageSummary } from '@autonomy/shared';

function totalRequests(summaries: UsageSummary[]): number {
  return summaries.reduce((sum, s) => sum + s.requestCount, 0);
}

function BarChart({ data, label }: { data: UsageSummary[]; label: string }) {
  const max = Math.max(...data.map((d) => d.requestCount), 1);

  if (data.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4">
        No {label.toLowerCase()} data
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((entry, i) => {
        const width = Math.max((entry.requestCount / max) * 100, 2);
        const keyLabel = entry.apiKeyName ?? entry.apiKeyId ?? 'anonymous';
        return (
          <div key={`${keyLabel}-${i}`} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground truncate max-w-[200px]">{keyLabel}</span>
              <span className="font-mono">{entry.requestCount}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/60 transition-all"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UsageDashboard({
  daily,
  monthly,
}: {
  daily: UsageSummary[];
  monthly: UsageSummary[];
}) {
  const todayTotal = totalRequests(daily);
  const monthTotal = totalRequests(monthly);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
              Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{todayTotal.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">requests</p>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
              This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{monthTotal.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">requests</p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm">Requests by Key (Today)</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart data={daily} label="Daily" />
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm">Requests by Key (Month)</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart data={monthly} label="Monthly" />
        </CardContent>
      </Card>
    </div>
  );
}
