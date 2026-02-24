'use client';

import type { EnvironmentConfig } from '@autonomy/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateConfig } from '@/lib/api';

export function ConfigForm({ config }: { config: EnvironmentConfig }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [aiBackend, setAiBackend] = useState<string>(config.AI_BACKEND);
  const [maxAgents, setMaxAgents] = useState(String(config.MAX_AGENTS));
  const [idleTimeout, setIdleTimeout] = useState(String(config.IDLE_TIMEOUT_MS));
  const [vectorProvider, setVectorProvider] = useState<string>(config.VECTOR_PROVIDER);
  const [logLevel, setLogLevel] = useState<string>(config.LOG_LEVEL);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await updateConfig({
        AI_BACKEND: aiBackend,
        MAX_AGENTS: Number(maxAgents),
        IDLE_TIMEOUT_MS: Number(idleTimeout),
        VECTOR_PROVIDER: vectorProvider,
        LOG_LEVEL: logLevel,
      });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="glass max-w-2xl">
      <CardHeader>
        <CardTitle className="text-sm">Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">AI Backend</label>
          <Select value={aiBackend} onValueChange={setAiBackend}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="codex">Codex</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
              <SelectItem value="pi">Pi</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Max Agents</label>
          <Input
            type="number"
            min={1}
            value={maxAgents}
            onChange={(e) => setMaxAgents(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Idle Timeout (ms)</label>
          <Input
            type="number"
            min={0}
            value={idleTimeout}
            onChange={(e) => setIdleTimeout(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Vector Provider</label>
          <Select value={vectorProvider} onValueChange={setVectorProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lancedb">LanceDB</SelectItem>
              <SelectItem value="qdrant">Qdrant</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Log Level</label>
          <Select value={logLevel} onValueChange={setLogLevel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && <p className="text-xs text-green-400">Configuration saved successfully</p>}

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </CardContent>
    </Card>
  );
}
