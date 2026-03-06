'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { createCron } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';

interface WorkflowStep {
  key: string;
  agentId: string;
  task: string;
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
] as const;

export function CreateCronDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [enabled, setEnabled] = useState(true);
  const [steps, setSteps] = useState<WorkflowStep[]>([{ key: '0', agentId: '', task: '' }]);

  function addStep() {
    setSteps([...steps, { key: String(Date.now()), agentId: '', task: '' }]);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, field: keyof WorkflowStep, value: string) {
    setSteps(steps.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const schedule = form.get('schedule') as string;

    if (!name || !schedule) {
      setError('Name and schedule are required.');
      setLoading(false);
      return;
    }

    const validSteps = steps.filter((s) => s.agentId && s.task);
    if (validSteps.length === 0) {
      setError('At least one workflow step with agent ID and task is required.');
      setLoading(false);
      return;
    }

    try {
      await createCron({
        name,
        schedule,
        timezone,
        enabled,
        workflow: {
          steps: validSteps,
          output: 'last',
        },
      });
      setOpen(false);
      setSteps([{ key: '0', agentId: '', task: '' }]);
      setTimezone('UTC');
      setEnabled(true);
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create cron job'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create Cron Job
        </Button>
      </DialogTrigger>
      <DialogContent className="border-primary/20 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-primary font-display tracking-wider">
            New Cron Job
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cron-name">Name</Label>
            <Input id="cron-name" name="name" placeholder="daily-report" className="font-mono" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule">Schedule (cron expression)</Label>
            <Input id="schedule" name="schedule" placeholder="0 9 * * *" className="font-mono" />
            <p className="text-[10px] text-muted-foreground">
              e.g. &quot;0 9 * * *&quot; = every day at 9:00 AM
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone">
                <SelectValue placeholder="UTC" />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Enabled</Label>
            <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Workflow Steps</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addStep}>
                <Plus className="mr-1 h-3 w-3" />
                Add Step
              </Button>
            </div>
            {steps.map((step, index) => (
              <div key={step.key} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder="Agent ID"
                    aria-label={`Step ${index + 1} agent ID`}
                    value={step.agentId}
                    onChange={(e) => updateStep(index, 'agentId', e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Input
                    placeholder="Task prompt"
                    aria-label={`Step ${index + 1} task prompt`}
                    value={step.task}
                    onChange={(e) => updateStep(index, 'task', e.target.value)}
                    className="text-xs"
                  />
                </div>
                {steps.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-status-red"
                    onClick={() => removeStep(index)}
                    aria-label={`Remove step ${index + 1}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-status-red">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating...' : 'Create Cron Job'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
