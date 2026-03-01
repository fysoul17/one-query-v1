'use client';

import type { BackendStatusResponse } from '@autonomy/shared';
import { useState } from 'react';
import { updateConfig } from '@/lib/api';
import { ProviderCard } from './provider-card';

interface ProviderListProps {
  status: BackendStatusResponse;
  onRefetch: () => void;
}

export function ProviderList({ status, onRefetch }: ProviderListProps) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSetDefault(backendName: string) {
    setSwitching(backendName);
    setError(null);
    try {
      await updateConfig({ AI_BACKEND: backendName });
      onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch backend');
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {status.backends.map((backend) => (
          <ProviderCard
            key={backend.name}
            backend={backend}
            isDefault={backend.name === status.defaultBackend}
            isSwitching={switching === backend.name}
            onSetDefault={() => handleSetDefault(backend.name)}
            onAuthChange={onRefetch}
          />
        ))}
      </div>
    </div>
  );
}
