import {
  type AgentDefinition,
  type AgentId,
  AgentOwner,
  type AgentRuntimeInfo,
  AgentStatus,
} from '@autonomy/shared';

export class MockAgentProcess {
  readonly id: string;
  readonly definition: AgentDefinition;
  private _status: AgentStatus = AgentStatus.IDLE;

  startCalls = 0;
  stopCalls = 0;
  restartCalls = 0;
  sendCalls: string[] = [];
  responseText = 'mock response';

  constructor(definition: AgentDefinition) {
    this.id = definition.id;
    this.definition = definition;
  }

  get status() {
    return this._status;
  }

  async start(): Promise<void> {
    this.startCalls++;
    this._status = AgentStatus.IDLE;
  }

  async stop(): Promise<void> {
    this.stopCalls++;
    this._status = AgentStatus.STOPPED;
  }

  async restart(): Promise<void> {
    this.restartCalls++;
    this._status = AgentStatus.IDLE;
  }

  async sendMessage(message: string): Promise<string> {
    this.sendCalls.push(message);
    return this.responseText;
  }

  toRuntimeInfo(): AgentRuntimeInfo {
    return {
      id: this.id,
      name: this.definition.name,
      role: this.definition.role,
      status: this._status,
      owner: this.definition.owner,
      persistent: this.definition.persistent,
      createdAt: this.definition.createdAt,
      lifecycle: this.definition.lifecycle,
      sessionId: this.definition.sessionId,
      backend: this.definition.backend,
    };
  }
}

export class MockPool {
  private agents = new Map<string, MockAgentProcess>();
  createCalls: AgentDefinition[] = [];
  removeCalls: string[] = [];

  async create(definition: AgentDefinition): Promise<MockAgentProcess> {
    this.createCalls.push(definition);
    const process = new MockAgentProcess(definition);
    this.agents.set(definition.id, process);
    return process;
  }

  get(id: AgentId): MockAgentProcess | undefined {
    return this.agents.get(id);
  }

  list(): AgentRuntimeInfo[] {
    return [...this.agents.values()].map((a) => a.toRuntimeInfo());
  }

  async remove(id: AgentId): Promise<void> {
    this.removeCalls.push(id);
    const agent = this.agents.get(id);
    if (agent) await agent.stop();
    this.agents.delete(id);
  }

  async sendMessage(id: AgentId, message: string): Promise<string> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent "${id}" not found`);
    return agent.sendMessage(message);
  }

  async shutdown(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.stop();
    }
    this.agents.clear();
  }

  // Helper: add a pre-existing agent
  addAgent(definition: AgentDefinition): MockAgentProcess {
    const process = new MockAgentProcess(definition);
    this.agents.set(definition.id, process);
    return process;
  }
}

export function makeDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'test-agent-1',
    name: 'Test Agent',
    role: 'general',
    tools: [],
    canModifyFiles: false,
    canDelegateToAgents: false,
    maxConcurrent: 1,
    owner: AgentOwner.USER,
    persistent: false,
    createdBy: 'api',
    createdAt: new Date().toISOString(),
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}
