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
  errorAfterContent?: string;

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

  async *handleMessageStreaming(message: IncomingMessage): AsyncGenerator<StreamEvent> {
    this.handleMessageCalls.push(message);
    if (this.shouldThrow) {
      yield { type: 'error', error: 'Mock conductor error' };
      return;
    }
    if (this.errorAfterContent) {
      yield { type: 'chunk', content: this.responseContent };
      yield { type: 'error', error: this.errorAfterContent };
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

  invalidateSessionBackendCalls: string[] = [];

  invalidateSessionBackend(sessionId: string): void {
    this.invalidateSessionBackendCalls.push(sessionId);
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}

/**
 * A controllable mock conductor where each stream event must be explicitly pushed.
 * Useful for testing mid-stream disconnect/reconnect scenarios.
 */
export class ControllableMockConductor extends MockConductor {
  private eventQueue: StreamEvent[] = [];
  private waiters: Array<(event: StreamEvent) => void> = [];

  override async *handleMessageStreaming(message: IncomingMessage): AsyncGenerator<StreamEvent> {
    this.handleMessageCalls.push(message);
    while (true) {
      const event = await this.nextEvent();
      yield event;
      if (event.type === 'complete' || event.type === 'error') break;
    }
  }

  private nextEvent(): Promise<StreamEvent> {
    return new Promise((resolve) => {
      if (this.eventQueue.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length check guarantees element exists
        resolve(this.eventQueue.shift()!);
      } else {
        this.waiters.push(resolve);
      }
    });
  }

  pushEvent(event: StreamEvent): void {
    if (this.waiters.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: length check guarantees element exists
      const waiter = this.waiters.shift()!;
      waiter(event);
    } else {
      this.eventQueue.push(event);
    }
  }

  emitChunk(content: string): void {
    this.pushEvent({ type: 'chunk', content });
  }

  emitComplete(): void {
    this.pushEvent({ type: 'complete' });
  }

  emitError(error: string): void {
    this.pushEvent({ type: 'error', error });
  }
}
