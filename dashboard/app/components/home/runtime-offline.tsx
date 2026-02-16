import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function RuntimeOffline() {
  return (
    <Card className="glass border-neon-red/30 glow-red">
      <CardContent className="flex items-center gap-4 py-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-red/10">
          <AlertTriangle className="h-6 w-6 text-neon-red" />
        </div>
        <div>
          <h3 className="font-bold text-neon-red">Runtime Offline</h3>
          <p className="text-sm text-muted-foreground">
            Cannot connect to the runtime at{' '}
            <code className="font-mono text-xs">
              {process.env.RUNTIME_URL ?? 'http://localhost:7820'}
            </code>
            . Make sure the server is running.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
