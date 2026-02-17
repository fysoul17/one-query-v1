'use client';

import type { ConductorPersonality } from '@autonomy/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { updateConductorSettings } from '@/lib/api';

interface ConductorSettingsFormProps {
  initialPersonality?: ConductorPersonality;
  conductorName: string;
  sessionId?: string;
}

const PRESETS: Record<string, ConductorPersonality> = {
  JARVIS: {
    name: 'JARVIS',
    communicationStyle: 'professional',
    traits: 'Sophisticated, efficient, and resourceful. Dry wit with impeccable timing.',
  },
  Friday: {
    name: 'Friday',
    communicationStyle: 'friendly',
    traits: 'Warm, proactive, and encouraging. Always looking out for the user.',
  },
  Alfred: {
    name: 'Alfred',
    communicationStyle: 'formal',
    traits: 'Dignified, discreet, and unflappable. Anticipates needs before they arise.',
  },
};

const STYLE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'concise', label: 'Concise' },
  { value: 'formal', label: 'Formal' },
  { value: 'friendly', label: 'Friendly' },
];

export function ConductorSettingsForm({
  initialPersonality,
  conductorName,
  sessionId,
}: ConductorSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialPersonality?.name ?? '');
  const [style, setStyle] = useState(initialPersonality?.communicationStyle ?? '');
  const [traits, setTraits] = useState(initialPersonality?.traits ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  function applyPreset(presetName: string) {
    const preset = PRESETS[presetName];
    if (!preset) return;
    setName(preset.name);
    setStyle(preset.communicationStyle ?? '');
    setTraits(preset.traits ?? '');
    setFeedback(null);
  }

  async function handleSave() {
    if (!name.trim()) {
      setFeedback({ type: 'error', message: 'Name is required.' });
      return;
    }
    setSaving(true);
    setFeedback(null);

    try {
      await updateConductorSettings({
        personality: {
          name: name.trim(),
          ...(style ? { communicationStyle: style } : {}),
          ...(traits.trim() ? { traits: traits.trim() } : {}),
        },
      });
      setFeedback({ type: 'success', message: 'Settings saved.' });
      router.refresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Conductor Identity */}
      <Card className="glass border-primary/20">
        <CardHeader>
          <CardTitle className="text-primary text-glow-cyan">Conductor Identity</CardTitle>
          <CardDescription>
            Give your conductor a personality. This affects how it communicates with you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Presets */}
          <div className="space-y-2">
            <Label>Quick Presets</Label>
            <div className="flex gap-2">
              {Object.keys(PRESETS).map((presetName) => (
                <Button
                  key={presetName}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(presetName)}
                  className="font-mono text-xs"
                >
                  {presetName}
                </Button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="conductor-name">Name</Label>
            <Input
              id="conductor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. JARVIS, Friday, Alfred"
              maxLength={50}
              className="font-mono"
            />
          </div>

          {/* Communication Style */}
          <div className="space-y-2">
            <Label htmlFor="communication-style">Communication Style</Label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger id="communication-style">
                <SelectValue placeholder="Select a style..." />
              </SelectTrigger>
              <SelectContent>
                {STYLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Traits */}
          <div className="space-y-2">
            <Label htmlFor="traits">Personality Traits</Label>
            <Textarea
              id="traits"
              value={traits}
              onChange={(e) => setTraits(e.target.value)}
              placeholder="Describe the conductor's personality..."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">{traits.length}/500</p>
          </div>

          {/* Save */}
          {feedback && (
            <p
              className={`text-sm ${feedback.type === 'success' ? 'text-neon-cyan' : 'text-neon-red'}`}
            >
              {feedback.message}
            </p>
          )}
          <Button onClick={handleSave} disabled={saving} className="w-full glow-cyan">
            {saving ? 'Saving...' : 'Save Identity'}
          </Button>
        </CardContent>
      </Card>

      {/* Session Info */}
      <Card className="glass border-border/30">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Session Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Current Name</span>
            <span className="font-mono text-xs">{conductorName}</span>
          </div>
          {sessionId && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Session ID</span>
              <span className="font-mono text-xs text-muted-foreground/60">
                {sessionId.slice(0, 8)}...
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
