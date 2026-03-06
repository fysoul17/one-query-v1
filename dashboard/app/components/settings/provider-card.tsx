'use client';

import type { BackendStatus } from '@autonomy/shared';
import { Check, Cpu, FileText, MessageSquare, Shield, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getBackendConfig } from '@/lib/backend-config';
import { AuthActions } from './auth-actions';

function StatusBadge({ backend }: { backend: BackendStatus }) {
  if (!backend.available) {
    return (
      <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20">
        Unavailable
      </Badge>
    );
  }
  if (!backend.configured) {
    return (
      <Badge
        variant="outline"
        className="bg-status-amber/10 text-status-amber border-status-amber/20"
      >
        Not Configured
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-status-green/10 text-status-green border-status-green/20"
    >
      Ready
    </Badge>
  );
}

function AuthInfo({ backend }: { backend: BackendStatus }) {
  if (backend.authMode === 'api_key' && backend.apiKeyMasked) {
    return (
      <div className="text-xs text-muted-foreground">
        <span className="text-foreground/70">API Key:</span> {backend.apiKeyMasked}
      </div>
    );
  }
  if (backend.authMode === 'cli_login') {
    return (
      <div className="text-xs text-muted-foreground">
        <span className="text-foreground/70">Auth:</span> CLI subscription login
      </div>
    );
  }
  // Pi: API key based auth
  if (backend.name === 'pi') {
    if (!backend.available) {
      return <div className="text-xs text-red-400">{backend.error ?? 'CLI not installed'}</div>;
    }
    if (!backend.configured) {
      return <div className="text-xs text-neon-amber">No API key configured</div>;
    }
  }
  if (!backend.available) {
    return <div className="text-xs text-red-400">{backend.error ?? 'CLI not installed'}</div>;
  }
  return <div className="text-xs text-status-amber">No authentication configured</div>;
}

function CapabilityList({ backend }: { backend: BackendStatus }) {
  const caps = [
    {
      key: 'streaming',
      label: 'Streaming',
      icon: MessageSquare,
      enabled: backend.capabilities.streaming,
    },
    {
      key: 'customTools',
      label: 'Tools',
      icon: Wrench,
      enabled: backend.capabilities.customTools,
    },
    {
      key: 'sessionPersistence',
      label: 'Sessions',
      icon: Shield,
      enabled: backend.capabilities.sessionPersistence,
    },
    {
      key: 'fileAccess',
      label: 'Files',
      icon: FileText,
      enabled: backend.capabilities.fileAccess,
    },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {caps.map((cap) => (
        <span
          key={cap.key}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
            cap.enabled
              ? 'bg-foreground/5 text-foreground/70'
              : 'bg-muted/50 text-muted-foreground/50 line-through'
          }`}
        >
          <cap.icon className="h-2.5 w-2.5" aria-hidden="true" />
          {cap.label}
          <span className="sr-only">: {cap.enabled ? 'supported' : 'not supported'}</span>
        </span>
      ))}
    </div>
  );
}

interface ProviderCardProps {
  backend: BackendStatus;
  isDefault: boolean;
  isSwitching: boolean;
  onSetDefault: () => void;
  onAuthChange: () => void;
}

export function ProviderCard({
  backend,
  isDefault,
  isSwitching,
  onSetDefault,
  onAuthChange,
}: ProviderCardProps) {
  const style = getBackendConfig(backend.name);

  return (
    <Card className={`${isDefault ? 'ring-1 ring-primary/30' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className={`h-4 w-4 ${style.color}`} aria-hidden="true" />
            <CardTitle className={`text-sm ${style.color}`}>{style.label}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {isDefault && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                Default
              </Badge>
            )}
            <StatusBadge backend={backend} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <AuthInfo backend={backend} />
        <CapabilityList backend={backend} />
        <AuthActions backend={backend} onAuthChange={onAuthChange} />
        {!isDefault && backend.available && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isSwitching}
            onClick={onSetDefault}
          >
            {isSwitching ? 'Switching...' : 'Set as Default'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
