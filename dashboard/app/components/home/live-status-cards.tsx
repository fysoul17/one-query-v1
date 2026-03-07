'use client';

import type { HealthCheckResponse, MemoryStats } from '@autonomy/shared';
import { Bot, Brain, Clock, Cpu, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HealthIndicator } from '@/components/home/health-indicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getHealth, getMemoryStats } from '@/lib/api';
import { formatBytes, formatUptime } from '@/lib/format';

const POLL_INTERVAL_MS = 10_000;
const STALE_THRESHOLD_MS = 30_000;

type ConnectionStatus = 'connected' | 'stale' | 'error';

const CONNECTION_DOT_CLASSES: Record<ConnectionStatus, string> = {
  connected: 'bg-status-green',
  stale: 'bg-status-amber',
  error: 'bg-status-red',
};

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  stale: 'Stale',
  error: 'Connection lost',
};

interface LiveStatusCardsProps {
  initialHealth: HealthCheckResponse;
  initialMemoryStats: MemoryStats | null;
}

export function LiveStatusCards({ initialHealth, initialMemoryStats }: LiveStatusCardsProps) {
  const [health, setHealth] = useState(initialHealth);
  const [memoryStats, setMemoryStats] = useState(initialMemoryStats);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [status, setStatus] = useState<ConnectionStatus>('connected');
  const [fetching, setFetching] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const statusRef = useRef<ConnectionStatus>('connected');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setFetching(true);
    try {
      const [h, m] = await Promise.all([
        getHealth(),
        getMemoryStats().catch((err) => {
          console.error('[LiveStatus] Failed to load memory stats:', err);
          return null;
        }),
      ]);
      setHealth(h);
      setMemoryStats(m);
      setLastUpdated(Date.now());
      setStatus('connected');
      statusRef.current = 'connected';
    } catch {
      setStatus('error');
      statusRef.current = 'error';
    } finally {
      setFetching(false);
    }
  }, []);

  // Polling interval — pauses when tab is hidden
  useEffect(() => {
    const start = () => {
      intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  // Elapsed time ticker + stale detection
  useEffect(() => {
    const ticker = setInterval(() => {
      const diff = Date.now() - lastUpdated;
      setElapsed(diff);
      if (diff > STALE_THRESHOLD_MS && statusRef.current === 'connected') {
        setStatus('stale');
        statusRef.current = 'stale';
      }
    }, 1_000);
    return () => clearInterval(ticker);
  }, [lastUpdated]);

  const elapsedLabel = elapsed < 5_000 ? 'just now' : `${Math.floor(elapsed / 1_000)}s ago`;

  return (
    <div className="space-y-2">
      <output
        className="flex items-center justify-end gap-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${CONNECTION_DOT_CLASSES[status]}`}
          aria-hidden="true"
        />
        <span>{status === 'error' ? 'Connection lost' : `Updated ${elapsedLabel}`}</span>
        <button
          type="button"
          onClick={refresh}
          disabled={fetching}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
          aria-label={`Refresh status — ${CONNECTION_LABELS[status]}`}
        >
          <RefreshCw className={`h-3 w-3 ${fetching ? 'animate-spin' : ''}`} />
        </button>
      </output>
      <div
        className={`grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${fetching ? 'opacity-80' : ''}`}
      >
        {/* System Status */}
        <Card className="card-hover accent-line-top transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              System
            </CardTitle>
            <Cpu className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <HealthIndicator status={health.status} />
              <span className="font-mono text-2xl font-bold capitalize text-foreground">
                {health.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {health.backendStatus
                ? `${health.backendStatus.default}: ${
                    health.backendStatus.backends.find(
                      (b) => b.name === health.backendStatus?.default,
                    )?.authenticated
                      ? 'connected'
                      : 'not authenticated'
                  }`
                : `v${health.version}`}
            </p>
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card className="card-hover accent-line-top transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Uptime
            </CardTitle>
            <Clock className="h-4 w-4 text-status-green" />
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-bold text-foreground">
              {formatUptime(health.uptime)}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {health.uptime.toLocaleString()}s total
            </p>
          </CardContent>
        </Card>

        {/* Agents */}
        <Card className="card-hover accent-line-top transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Agents
            </CardTitle>
            <Bot className="h-4 w-4 text-status-purple" />
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-bold text-foreground">
              {health.agentCount}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">active processes</p>
          </CardContent>
        </Card>

        {/* Memory */}
        <Card className="card-hover accent-line-top transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Memory
            </CardTitle>
            <Brain className="h-4 w-4 text-status-amber" />
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-bold text-foreground">
              {memoryStats ? memoryStats.totalEntries : 0}
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {memoryStats ? formatBytes(memoryStats.storageUsedBytes) : '0 B'} stored
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
