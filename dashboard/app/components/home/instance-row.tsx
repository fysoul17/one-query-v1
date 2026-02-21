'use client';

import type { InstanceInfo } from '@autonomy/shared';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { deleteInstance } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { StatusBadge } from './instance-status';

function MemoryBadge({ status }: { status: string }) {
  const isOk = status === 'ok';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
        isOk ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
      }`}
    >
      {status}
    </span>
  );
}

export function InstanceRow({ instance }: { instance: InstanceInfo }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const hostPort = `${instance.hostname}:${instance.port}`;
  const isUnreachable = instance.status === 'unreachable';

  async function handleDelete() {
    setLoading(true);
    setError('');
    try {
      await deleteInstance(instance.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setLoading(false);
      setShowDelete(false);
    }
  }

  return (
    <div className="rounded-md border border-border/50 bg-muted/30">
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`}
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground font-mono truncate" title={hostPort}>
                  {hostPort}
                </span>
              </TooltipTrigger>
              <TooltipContent>{hostPort}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-muted-foreground">
            {instance.agentCount} agent{instance.agentCount !== 1 ? 's' : ''}
          </span>
          <StatusBadge status={instance.status} />
        </div>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-border/50 px-3 py-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="text-muted-foreground">Version</div>
            <div className="font-mono">v{instance.version}</div>
            <div className="text-muted-foreground">Uptime</div>
            <div>{formatRelativeTime(instance.startedAt).replace(' ago', '')}</div>
            <div className="text-muted-foreground">Last heartbeat</div>
            <div>{formatRelativeTime(instance.lastHeartbeat)}</div>
            <div className="text-muted-foreground">Memory</div>
            <div>
              <MemoryBadge status={instance.memoryStatus} />
            </div>
          </div>

          {error && <p className="text-[10px] text-neon-red">{error}</p>}

          {isUnreachable && (
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-neon-red hover:text-neon-red hover:bg-neon-red/10"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDelete(true);
                }}
                disabled={loading}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Remove instance
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent className="glass border-neon-red/30">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Instance</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong className="font-mono">{hostPort}</strong> from the registry? This only
              removes the stale entry — it does not affect a running server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={loading}
              className="bg-neon-red hover:bg-neon-red/80"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
