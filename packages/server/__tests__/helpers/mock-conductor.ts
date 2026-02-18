import type { ConductorResponse, IncomingMessage } from '@autonomy/conductor';
import type { ActivityEntry, AgentId, AgentRuntimeInfo, StreamEvent } from '@autonomy/shared';
import { ActivityType, AgentOwner, AgentStatus } from '@autonomy/shared';

let counter = 0;

export class MockConductor {
  private agents: AgentRuntimeInfo[] = [];
  private activity: ActivityEntry[] = [];
  initialized = false;

  handleMessageCalls: IncomingMessage[] = [];
  createAgentCalls: Array<{ name: string; role: string; systemPrompt: string }> = [];
  deleteAgentCalls: string[] = [];

  responseContent = 'Mock conductor response';
  shouldThrow = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async handleMessage(message: IncomingMessage): Promise<ConductorResponse> {
    this.handleMessageCalls.push(message);
    if (this.shouldThrow) throw new Error('Mock conductor error');
    return {
      content: this.responseContent,
      agentId: message.targetAgentId ?? 'conductor',
      decisions: [],
    };
  }

  async *handleMessageStreaming(
    message: IncomingMessage,
  ): AsyncGenerator<StreamEvent> {
    this.handleMessageCalls.push(message);
    if (this.shouldThrow) {
      yield { type: 'error', error: 'Mock conductor error' };
      return;
    }
    yield { type: 'chunk', content: this.responseContent };
    yield { type: 'complete' };
  }

  async createAgent(params: {
    name: string;
    role: string;
    systemPrompt: string;
    tools?: string[];
    persistent?: boolean;
  }): Promise<AgentRuntimeInfo> {
    this.createAgentCalls.push(params);
    counter++;
    const info: AgentRuntimeInfo = {
      id: `agent-${counter}`,
      name: params.name,
      role: params.role,
      status: AgentStatus.IDLE,
      owner: AgentOwner.CONDUCTOR,
      persistent: params.persistent ?? false,
      createdAt: new Date().toISOString(),
    };
    this.agents.push(info);
    return info;
  }

  async deleteAgent(agentId: AgentId): Promise<void> {
    this.deleteAgentCalls.push(agentId);
    this.agents = this.agents.filter((a) => a.id !== agentId);
  }

  listAgents(): AgentRuntimeInfo[] {
    return this.agents;
  }

  async sendToAgent(agentId: AgentId, message: string): Promise<string> {
    return `Response from ${agentId}: ${message}`;
  }

  get conductorName(): string {
    return 'Conductor';
  }

  getActivity(limit?: number): ActivityEntry[] {
    const l = limit ?? this.activity.length;
    return this.activity.slice(-l).reverse();
  }

  getAgentActivity(agentId: AgentId, limit?: number): ActivityEntry[] {
    return this.activity.filter((a) => a.agentId === agentId).slice(-(limit ?? 50));
  }

  addActivity(entry: Partial<ActivityEntry>): void {
    this.activity.push({
      id: `act-${this.activity.length + 1}`,
      timestamp: new Date().toISOString(),
      type: ActivityType.MESSAGE,
      details: 'test activity',
      ...entry,
    });
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}
