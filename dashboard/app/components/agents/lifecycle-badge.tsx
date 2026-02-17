import type { AgentLifecycle } from '@autonomy/shared';
import { Anchor, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const lifecycleConfig: Record<string, { label: string; icon: typeof Anchor; className: string }> = {
  persistent: {
    label: 'Persistent',
    icon: Anchor,
    className: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20',
  },
  ephemeral: {
    label: 'Ephemeral',
    icon: Zap,
    className: 'bg-neon-amber/10 text-neon-amber border-neon-amber/20',
  },
};

const defaultLifecycleConfig = {
  label: 'Unknown',
  icon: Zap,
  className: 'bg-muted text-muted-foreground border-border',
};

export function LifecycleBadge({
  lifecycle,
  persistent,
}: {
  lifecycle?: AgentLifecycle;
  persistent?: boolean;
}) {
  const key = lifecycle ?? (persistent ? 'persistent' : 'ephemeral');
  const config = lifecycleConfig[key] ?? defaultLifecycleConfig;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`gap-1 ${config.className}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
