'use client';

import { ApiKeyCard } from './api-key-card';
import type { ApiKey } from '@autonomy/shared';

export function ApiKeyList({ keys }: { keys: ApiKey[] }) {
  if (keys.length === 0) {
    return (
      <div className="glass rounded-lg p-8 text-center text-muted-foreground">
        No API keys configured. Create one to enable authenticated access.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {keys.map((key) => (
        <ApiKeyCard key={key.id} apiKey={key} />
      ))}
    </div>
  );
}
