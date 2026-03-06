import type { AIBackend } from '@autonomy/shared';
import { Cpu } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getBackendConfig } from '@/lib/backend-config';

export function BackendBadge({ backend }: { backend?: AIBackend }) {
  if (!backend) return null;
  const config = getBackendConfig(backend);

  return (
    <Badge variant="outline" className={`gap-1 ${config.badgeClass}`}>
      <Cpu className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
