import type { AgentPool } from '@autonomy/agent-manager';
import type { Conductor } from '@autonomy/conductor';
import { type AgentDefinition, AgentOwner, type CreateAgentRequest } from '@autonomy/shared';
import { nanoid } from 'nanoid';
import { BadRequestError, NotFoundError } from '../errors.ts';
import { errorResponse, jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';

export function createAgentRoutes(conductor: Conductor, pool: AgentPool) {
  return {
    list: async (): Promise<Response> => {
      const agents = conductor.listAgents();
      return jsonResponse(agents);
    },

    create: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<CreateAgentRequest>(req);

      if (!body.name || !body.role || !body.systemPrompt) {
        throw new BadRequestError('name, role, and systemPrompt are required');
      }

      const id = nanoid();
      const definition: AgentDefinition = {
        id,
        name: body.name,
        role: body.role,
        tools: body.tools ?? [],
        canModifyFiles: body.canModifyFiles ?? false,
        canDelegateToAgents: body.canDelegateToAgents ?? false,
        maxConcurrent: body.maxConcurrent ?? 1,
        owner: AgentOwner.USER,
        persistent: body.persistent ?? false,
        createdBy: 'api',
        createdAt: new Date().toISOString(),
        systemPrompt: body.systemPrompt,
      };

      const process = await pool.create(definition);
      return jsonResponse(process.toRuntimeInfo(), 201);
    },

    update: async (_req: Request, _params: RouteParams): Promise<Response> => {
      return errorResponse('Agent update not implemented yet', 501);
    },

    remove: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Agent id is required');

      const agent = pool.get(id);
      if (!agent) throw new NotFoundError(`Agent "${id}" not found`);

      await conductor.deleteAgent(id);
      return jsonResponse({ deleted: id });
    },

    restart: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Agent id is required');

      const agent = pool.get(id);
      if (!agent) throw new NotFoundError(`Agent "${id}" not found`);

      await agent.restart();
      return jsonResponse(agent.toRuntimeInfo());
    },
  };
}
