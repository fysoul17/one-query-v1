'use client';

import type { MemoryEntry } from '@autonomy/shared';
import { Archive, Trash2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { deleteMemoryEntry, forgetMemory } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';
import { memoryTypeBadgeVariant } from './memory-utils';

interface EntryDetailDialogProps {
  entry: MemoryEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate?: () => void;
}

export function EntryDetailDialog({ entry, open, onOpenChange, onMutate }: EntryDetailDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'delete' | 'forget' | null>(null);

  if (!entry) return null;

  async function handleDelete() {
    if (!entry) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMemoryEntry(entry.id);
      onOpenChange(false);
      onMutate?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete entry'));
    } finally {
      setDeleting(false);
      setConfirmAction(null);
    }
  }

  async function handleForget() {
    if (!entry) return;
    setForgetting(true);
    setError(null);
    try {
      await forgetMemory(entry.id, 'Manually forgotten via dashboard');
      onOpenChange(false);
      onMutate?.();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to forget entry'));
    } finally {
      setForgetting(false);
      setConfirmAction(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="glass border-primary/20 sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-display tracking-wider">
              <span className="font-mono text-sm">{entry.id.slice(0, 16)}...</span>
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="space-y-4 pr-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={memoryTypeBadgeVariant(entry.type)}>{entry.type}</Badge>
                  {entry.agentId && (
                    <Badge variant="outline" className="font-mono">
                      agent: {entry.agentId}
                    </Badge>
                  )}
                  {entry.sessionId && (
                    <Badge variant="outline" className="font-mono">
                      session: {entry.sessionId.slice(0, 8)}
                    </Badge>
                  )}
                </div>

                <div className="rounded-md border bg-muted/50 p-4">
                  <p className="whitespace-pre-wrap text-sm">{entry.content}</p>
                </div>

                {Object.keys(entry.metadata).length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Metadata</p>
                    <pre className="rounded-md border bg-muted/50 p-3 font-mono text-xs">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
            <span>Created: {new Date(entry.createdAt).toLocaleString()}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction('forget')}
                disabled={forgetting || deleting}
                className="gap-1"
              >
                <Archive className="h-3 w-3" />
                {forgetting ? 'Forgetting...' : 'Forget'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmAction('delete')}
                disabled={deleting || forgetting}
                className="gap-1"
              >
                <Trash2 className="h-3 w-3" />
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs text-neon-red">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAction !== null} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent className="border-status-red/30">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'delete' ? 'Delete Memory Entry' : 'Forget Memory Entry'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'delete'
                ? 'This will permanently delete this memory entry. This action cannot be undone.'
                : 'This will archive this memory entry and mark it as forgotten. The entry will no longer appear in searches.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction === 'delete' ? handleDelete : handleForget}
              className={
                confirmAction === 'delete' ? 'bg-status-red hover:bg-status-red/80' : undefined
              }
            >
              {confirmAction === 'delete' ? 'Delete' : 'Forget'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
