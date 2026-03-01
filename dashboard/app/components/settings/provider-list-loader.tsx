'use client';

import type { BackendStatusResponse } from '@autonomy/shared';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getBackendStatus } from '@/lib/api';
import { ProviderCardSkeleton } from './provider-card-skeleton';
import { ProviderList } from './provider-list';

export function ProviderListLoader() {
  const [status, setStatus] = useState<BackendStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getBackendStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect to runtime');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (error && !status) {
    return (
      <div className="glass rounded-lg p-8 text-center text-muted-foreground">
        <p>{error}. Check that the server is running.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={fetchStatus}>
          Retry
        </Button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <ProviderCardSkeleton key="a" />
        <ProviderCardSkeleton key="b" />
        <ProviderCardSkeleton key="c" />
        <ProviderCardSkeleton key="d" />
      </div>
    );
  }

  return <ProviderList status={status} onRefetch={fetchStatus} />;
}
