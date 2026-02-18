import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InstanceInfo } from '@autonomy/shared';
import { Server } from 'lucide-react';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    healthy: 'bg-green-500/10 text-green-400',
    unreachable: 'bg-red-500/10 text-red-400',
    draining: 'bg-amber-500/10 text-amber-400',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
        styles[status] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {status}
    </span>
  );
}

export function InstanceStatus({ instances }: { instances: InstanceInfo[] }) {
  return (
    <Card className="glass glass-hover transition-all">
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Server className="h-4 w-4 text-primary" />
        <CardTitle className="text-sm font-medium">Instances</CardTitle>
      </CardHeader>
      <CardContent>
        {instances.length === 0 ? (
          <p className="text-xs text-muted-foreground">No instances registered</p>
        ) : (
          <div className="space-y-2">
            {instances.map((instance) => (
              <div key={instance.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-mono truncate max-w-[180px]">
                  {instance.hostname}:{instance.port}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {instance.agentCount} agent{instance.agentCount !== 1 ? 's' : ''}
                  </span>
                  <StatusBadge status={instance.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
