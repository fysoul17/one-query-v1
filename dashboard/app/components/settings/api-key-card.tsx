'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { deleteApiKey, updateApiKey } from '@/lib/api';
import type { ApiKey } from '@autonomy/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApiKeyCard({ apiKey }: { apiKey: ApiKey }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleToggle() {
    setLoading(true);
    setError(null);
    try {
      await updateApiKey(apiKey.id, { enabled: !apiKey.enabled });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update key');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await deleteApiKey(apiKey.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key');
      setConfirmDelete(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="glass glass-hover">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{apiKey.name}</CardTitle>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
              apiKey.enabled
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400'
            }`}
          >
            {apiKey.enabled ? 'Active' : 'Disabled'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          <p>
            <span className="font-mono">{apiKey.keyPrefix}...</span>
          </p>
          <p className="mt-1">
            Scopes: {apiKey.scopes.join(', ')}
          </p>
          {apiKey.lastUsedAt && (
            <p className="mt-1">
              Last used: {new Date(apiKey.lastUsedAt).toLocaleDateString()}
            </p>
          )}
          <p className="mt-1">
            Created: {new Date(apiKey.createdAt).toLocaleDateString()}
          </p>
        </div>
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggle}
            disabled={loading}
            className="flex-1 text-xs"
          >
            {apiKey.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant={confirmDelete ? 'destructive' : 'outline'}
            size="sm"
            onClick={handleDelete}
            onBlur={() => setConfirmDelete(false)}
            disabled={loading}
            className="text-xs"
          >
            {confirmDelete ? 'Confirm?' : 'Delete'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
