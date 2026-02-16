export interface PhaseConfig {
  dot: string;
  text: string;
  label: string;
}

export const PHASE_CONFIG: Record<string, PhaseConfig> = {
  memory_search: { dot: 'bg-neon-cyan', text: 'text-neon-cyan', label: 'Memory Search' },
  analyzing: { dot: 'bg-neon-purple', text: 'text-neon-purple', label: 'Routing' },
  routing_complete: { dot: 'bg-neon-purple', text: 'text-neon-purple', label: 'Route Decided' },
  creating_agent: { dot: 'bg-neon-green', text: 'text-neon-green', label: 'Agent Creation' },
  delegating: { dot: 'bg-neon-amber', text: 'text-neon-amber', label: 'Delegation' },
  delegation_complete: { dot: 'bg-neon-amber', text: 'text-neon-amber', label: 'Complete' },
  memory_store: { dot: 'bg-neon-green', text: 'text-neon-green', label: 'Memory Store' },
  responding: { dot: 'bg-neon-cyan', text: 'text-neon-cyan', label: 'Direct Response' },
};

const DEFAULT_CONFIG: PhaseConfig = {
  dot: 'bg-muted-foreground',
  text: 'text-muted-foreground',
  label: '',
};

export function getPhaseConfig(phase: string): PhaseConfig {
  return PHASE_CONFIG[phase] ?? { ...DEFAULT_CONFIG, label: phase };
}
