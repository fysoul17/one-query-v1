'use client';

import type { BackendStatusResponse } from '@autonomy/shared';
import { Cpu } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getBackendStatus } from '@/lib/api';

const backendColors: Record<string, string> = {
  claude: 'text-neon-purple',
  codex: 'text-neon-green',
  gemini: 'text-neon-cyan',
  pi: 'text-neon-amber',
};

const backendLabels: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  pi: 'Pi',
};

type ChipStatus = 'connected' | 'no_key' | 'unavailable' | 'loading' | 'error';

function statusDot(status: ChipStatus) {
  switch (status) {
    case 'connected':
      return 'bg-neon-green';
    case 'no_key':
      return 'bg-neon-amber';
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

export function BackendStatusChip() {
  const [data, setData] = useState<BackendStatusResponse | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function pollStatus() {
      try {
        const result = await getBackendStatus();
        if (!cancelled) {
          setData(result);
          setHasError(false);
        }
      } catch {
        if (!cancelled) setHasError(true);
      }
    }
    pollStatus();
    const interval = setInterval(pollStatus, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const status = deriveStatus(data, hasError);
  const backendName = data?.defaultBackend ?? 'claude';
  const label = backendLabels[backendName] ?? backendName;
  const color = backendColors[backendName] ?? 'text-muted-foreground';

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
