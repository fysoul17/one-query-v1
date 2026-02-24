'use client';

import type { CronExecutionLog } from '@autonomy/shared';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getCronLogs } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

interface CronLogsDialogProps {
  cronId: string;
  cronName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CronLogsDialog({ cronId, cronName, open, onOpenChange }: CronLogsDialogProps) {
  const [logs, setLogs] = useState<CronExecutionLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLogs([]);
    setLoading(true);
    setError('');
    getCronLogs(cronId, 50)
      .then((data) => setLogs([...data].reverse()))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load logs'))
      .finally(() => setLoading(false));
  }, [open, cronId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Logs: {cronName}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          )}
          {error && <div className="py-8 text-center text-sm text-neon-red">{error}</div>}
          {!loading && !error && logs.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">No executions yet.</div>
          )}
          {!loading && !error && logs.length > 0 && (
            <div className="space-y-2 pr-4">
              {logs.map((log, i) => (
                <div
                  key={`${log.cronId}-${log.executedAt}-${i}`}
                  className="rounded-md border border-border/50 bg-background/30 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={log.success ? 'default' : 'destructive'}
                      className="text-[10px]"
                    >
                      {log.success ? 'SUCCESS' : 'FAILED'}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatRelativeTime(log.executedAt)}
                    </span>
                  </div>
                  {log.result && (
                    <p className="line-clamp-3 font-mono text-[11px] text-muted-foreground">
                      {log.result}
                    </p>
                  )}
                  {log.error && (
                    <p className="line-clamp-2 font-mono text-[11px] text-neon-red">{log.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
