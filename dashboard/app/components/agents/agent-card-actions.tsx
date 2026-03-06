'use client';

import type { AgentRuntimeInfo } from '@autonomy/shared';
import { MoreVertical, Pencil, RotateCw, Trash2 } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteAgent, restartAgent } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';
import { EditAgentDialog } from './edit-agent-dialog';

export function AgentCardActions({ agent }: { agent: AgentRuntimeInfo }) {
  const router = useRouter();
  const [showDelete, setShowDelete] = useState(false);
  const [showRestart, setShowRestart] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRestart() {
    setLoading(true);
    setError('');
    try {
      await restartAgent(agent.id);
      toast.success(`Agent "${agent.name}" restarted`);
      router.refresh();
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to restart');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setShowRestart(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    setError('');
    try {
      await deleteAgent(agent.id);
      toast.success(`Agent "${agent.name}" deleted`);
      router.refresh();
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to delete');
      setError(msg);
      toast.error(msg);
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            aria-label="Agent actions"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowEdit(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowRestart(true)} disabled={loading}>
            <RotateCw className="mr-2 h-4 w-4" />
            Restart
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowDelete(true)}
            disabled={loading || agent.owner === 'system'}
            className="text-status-red focus:text-status-red"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditAgentDialog agent={agent} open={showEdit} onOpenChange={setShowEdit} />

      <AlertDialog open={showRestart} onOpenChange={setShowRestart}>
        <AlertDialogContent className="border-primary/30">
          <AlertDialogHeader>
            <AlertDialogTitle>Restart Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restart <strong>{agent.name}</strong>? The agent will be
              stopped and started again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestart}>Restart</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent className="border-status-red/30">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{agent.name}</strong>? This action cannot be
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
