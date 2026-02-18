import { AgentList } from '@/components/agents/agent-list';
import { CreateAgentDialog } from '@/components/agents/create-agent-dialog';
import { Header } from '@/components/layout/header';
import { getAgents } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  let agents: Awaited<ReturnType<typeof getAgents>> = [];
  try {
    agents = await getAgents();
  } catch {
    agents = [];
  }

  return (
    <>
      <Header title="Agents" />
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Agent Fleet</h2>
            <p className="text-sm text-muted-foreground">
              {agents.length} agent{agents.length !== 1 ? 's' : ''} registered
            </p>
          </div>
          <CreateAgentDialog />
        </div>
        <AgentList agents={agents} />
      </div>
    </>
  );
}
