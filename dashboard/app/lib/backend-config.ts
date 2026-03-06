/** Shared backend display configuration — single source of truth for labels, colors, and badge styles. */

export interface BackendConfig {
  label: string;
  color: string;
  badgeClass: string;
}

export const BACKEND_CONFIG: Record<string, BackendConfig> = {
  claude: {
    label: 'Claude',
    color: 'text-neon-purple',
    badgeClass: 'bg-neon-purple/10 text-neon-purple border-neon-purple/20',
  },
  codex: {
    label: 'Codex',
    color: 'text-neon-green',
    badgeClass: 'bg-neon-green/10 text-neon-green border-neon-green/20',
  },
  gemini: {
    label: 'Gemini',
    color: 'text-neon-cyan',
    badgeClass: 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20',
  },
  pi: {
    label: 'Pi',
    color: 'text-neon-amber',
    badgeClass: 'bg-neon-amber/10 text-neon-amber border-neon-amber/20',
  },
};

export const DEFAULT_BACKEND_CONFIG: BackendConfig = {
  label: 'Unknown',
  color: 'text-muted-foreground',
  badgeClass: 'bg-muted text-muted-foreground border-border',
};

export function getBackendConfig(name: string): BackendConfig {
  return BACKEND_CONFIG[name] ?? DEFAULT_BACKEND_CONFIG;
}
