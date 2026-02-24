import type { AIBackend } from '@autonomy/shared';
import { Cpu } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const backendConfig: Record<string, { label: string; className: string }> = {
  claude: {
    label: 'Claude',
    className: 'bg-neon-purple/10 text-neon-purple border-neon-purple/20',
  },
  codex: {
    label: 'Codex',
    className: 'bg-neon-green/10 text-neon-green border-neon-green/20',
  },
  gemini: {
    label: 'Gemini',
    className: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20',
  },
  pi: {
    label: 'Pi',
    className: 'bg-neon-amber/10 text-neon-amber border-neon-amber/20',
  },
};

const defaultBackendConfig = {
  label: 'Unknown',
  className: 'bg-muted text-muted-foreground border-border',
};

export function BackendBadge({ backend }: { backend?: AIBackend }) {
  if (!backend) return null;
  const config = backendConfig[backend] ?? defaultBackendConfig;

  return (
    <Badge variant="outline" className={`gap-1 ${config.className}`}>
      <Cpu className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
