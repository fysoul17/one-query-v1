'use client';

import { MessageSquare, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { deleteSession, summarizeSession } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';

interface SessionCardActionsProps {
  sessionId: string;
  title: string;
}

export function SessionCardActions({ sessionId, title }: SessionCardActionsProps) {
  const router = useRouter();
  const [showDelete, setShowDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSummarize() {
    setLoading(true);
    setError('');
    try {
      await summarizeSession(sessionId);
      toast.success('Session summarized');
      router.refresh();
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to summarize');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    setError('');
    try {
      await deleteSession(sessionId);
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete'));
    } finally {
      setLoading(false);
      setShowDelete(false);
    }
  }

  return (
    <>
      {error && (
        <p className="absolute -bottom-5 left-0 right-0 text-[10px] text-status-red truncate">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          aria-label="Resume session"
          asChild
        >
          <Link href={`/chat?sessionId=${sessionId}`}>
            <MessageSquare className="h-4 w-4" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          aria-label="Summarize session"
          onClick={handleSummarize}
          disabled={loading}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-status-red"
          aria-label="Delete session"
          onClick={() => setShowDelete(true)}
          disabled={loading}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent className="border-status-red/30">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{title}</strong>? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-status-red hover:bg-status-red/80"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
