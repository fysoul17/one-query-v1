import type { AgentRuntimeInfo } from '@autonomy/shared';
import { isAgentPersistent } from '@autonomy/shared';
import { AgentCard } from './agent-card';

interface AgentListProps {
  agents: AgentRuntimeInfo[];
}

export function AgentList({ agents }: AgentListProps) {
  if (agents.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No agents running. Create one to get started.</p>
      </div>
    );
  }

  const persistent = agents.filter(isAgentPersistent);
  const ephemeral = agents.filter((a) => !isAgentPersistent(a));

  const groups = [
    { label: 'Persistent', agents: persistent },
    { label: 'Ephemeral', agents: ephemeral },
  ].filter((g) => g.agents.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {group.label} ({group.agents.length})
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
