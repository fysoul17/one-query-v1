import type { AgentRuntimeInfo } from '@autonomy/shared';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import { AgentCardActions } from './agent-card-actions';
import { LifecycleBadge } from './lifecycle-badge';
import { OwnerBadge } from './owner-badge';
import { StatusBadge } from './status-badge';

const statusGlow: Record<string, string> = {
  active: 'hover:border-neon-cyan/30 hover:glow-cyan',
  idle: 'hover:border-neon-amber/30 hover:glow-amber',
  busy: 'hover:border-neon-purple/30 hover:glow-purple',
  stopped: '',
  error: 'hover:border-neon-red/30 hover:glow-red',
};

export function AgentCard({ agent }: { agent: AgentRuntimeInfo }) {
  const glow = statusGlow[agent.status] ?? '';

  return (
    <Card className={`glass transition-all hover:scale-[1.02] ${glow}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-bold text-foreground">{agent.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{agent.role}</p>
        </div>
        <AgentCardActions agent={agent} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={agent.status} />
          <OwnerBadge owner={agent.owner} />
          <LifecycleBadge lifecycle={agent.lifecycle} persistent={agent.persistent} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono">{agent.id.slice(0, 8)}...</span>
          <span>{formatRelativeTime(agent.createdAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
