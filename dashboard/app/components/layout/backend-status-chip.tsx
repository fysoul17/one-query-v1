'use client';

import type { BackendStatusResponse } from '@autonomy/shared';
import { Cpu } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getBackendStatus } from '@/lib/api';
import { getBackendConfig } from '@/lib/backend-config';

type ChipStatus = 'connected' | 'no_key' | 'unavailable' | 'loading' | 'error';

function statusDot(status: ChipStatus) {
  switch (status) {
    case 'connected':
      return 'bg-status-green';
    case 'no_key':
      return 'bg-status-amber';
    case 'unavailable':
    case 'error':
      return 'bg-red-500';
    case 'loading':
      return 'bg-muted-foreground animate-pulse';
  }
}

function statusText(status: ChipStatus) {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'no_key':
      return 'No API Key';
    case 'unavailable':
      return 'Unavailable';
    case 'error':
      return 'Offline';
    case 'loading':
      return 'Checking...';
  }
}

function deriveStatus(data: BackendStatusResponse | null, hasError: boolean): ChipStatus {
  if (hasError && !data) return 'error';
  if (!data) return 'loading';
  const active = data.backends.find((b) => b.name === data.defaultBackend);
  if (!active) return 'unavailable';
  if (!active.available) return 'unavailable';
  if (!active.configured) return 'no_key';
  return 'connected';
}

/** Poll fast (5s) while disconnected, slow (30s) once connected. */
const POLL_FAST_MS = 5_000;
const POLL_SLOW_MS = 30_000;

export function BackendStatusChip() {
  const [data, setData] = useState<BackendStatusResponse | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function pollStatus() {
      try {
        const result = await getBackendStatus();
        if (!cancelled) {
          setData(result);
          setHasError(false);
          timer = setTimeout(pollStatus, POLL_SLOW_MS);
        }
      } catch {
        if (!cancelled) {
          setHasError(true);
          timer = setTimeout(pollStatus, POLL_FAST_MS);
        }
      }
    }
    pollStatus();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const status = deriveStatus(data, hasError);
  const backendName = data?.defaultBackend ?? 'claude';
  const { label, color } = getBackendConfig(backendName);

  return (
    <Link
      href="/settings/providers"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      aria-label={`Backend status: ${label} ${statusText(status)}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot(status)}`}
        aria-hidden="true"
      />
      <Cpu className={`h-3 w-3 shrink-0 ${color}`} aria-hidden="true" />
      <span className={color}>{label}</span>
      <span className="text-[10px] text-muted-foreground">{statusText(status)}</span>
    </Link>
  );
}
