'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createApiKey } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const AVAILABLE_SCOPES = ['admin', 'read', 'write', 'agents', 'memory', 'crons'] as const;

export function CreateApiKeyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleCreate() {
    if (!name || scopes.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const result = await createApiKey({
        name,
        scopes: scopes as typeof AVAILABLE_SCOPES[number][],
      });
      setRawKey(result.rawKey);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (rawKey) {
      navigator.clipboard.writeText(rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleClose() {
    setOpen(false);
    setName('');
    setScopes(['read']);
    setRawKey(null);
    setCopied(false);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button size="sm" className="glow-cyan">
          Create API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{rawKey ? 'API Key Created' : 'Create API Key'}</DialogTitle>
        </DialogHeader>

        {rawKey ? (
          <div className="space-y-4">
            <p className="text-xs text-amber-400">
              Copy this key now. It will not be shown again.
            </p>
            <div className="flex gap-2">
              <code className="flex-1 rounded bg-muted p-2 text-xs font-mono break-all">
                {rawKey}
              </code>
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                placeholder="My API Key"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Scopes</label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_SCOPES.map((scope) => (
                  <button
                    type="button"
                    key={scope}
                    onClick={() => toggleScope(scope)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      scopes.includes(scope)
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : 'bg-muted text-muted-foreground border border-transparent'
                    }`}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <Button
              onClick={handleCreate}
              disabled={loading || !name || scopes.length === 0}
              className="w-full"
            >
              {loading ? 'Creating...' : 'Create Key'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
