import type { AgentPool } from '@autonomy/agent-manager';
import type { Conductor } from '@autonomy/conductor';
import {
  type AgentDefinition,
  AgentOwner,
  AIBackend,
  type CreateAgentRequest,
  type UpdateAgentRequest,
} from '@autonomy/shared';
import crypto from 'node:crypto';
import { BadRequestError, NotFoundError, ServerError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';
import type { RouteParams } from '../router.ts';

/** Tool names must be alphanumeric with underscores, colons, or dots — prevents CLI argument injection. */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_:.]+$/;

function validateToolNames(tools: unknown): void {
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (typeof tool !== 'string' || !TOOL_NAME_PATTERN.test(tool)) {
      throw new BadRequestError(
        `Invalid tool name "${tool}". Tool names must match ${TOOL_NAME_PATTERN}`,
      );
    }
  }
}

export function createAgentRoutes(conductor: Conductor, pool: AgentPool) {
  return {
    list: async (_req: Request): Promise<Response> => {
      const agents = conductor.listAgents();
      return jsonResponse(agents);
    },

    create: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<CreateAgentRequest>(req);

      if (!body.name || !body.role || !body.systemPrompt) {
        throw new BadRequestError('name, role, and systemPrompt are required');
      }

      if (body.systemPrompt.length > 100_000) {
        throw new ServerError('System prompt exceeds maximum length of 100,000 characters', 400);
      }

      const validBackends = Object.values(AIBackend) as string[];
      if (body.backend && !validBackends.includes(body.backend)) {
        throw new BadRequestError(
          `Invalid backend "${body.backend}". Valid: ${validBackends.join(', ')}`,
        );
      }

      validateToolNames(body.tools);

      const id = crypto.randomUUID();
      const persistent = body.persistent ?? false;
      const definition: AgentDefinition = {
        id,
        name: body.name,
        role: body.role,
        tools: body.tools ?? [],
        canModifyFiles: body.canModifyFiles ?? false,
        canDelegateToAgents: body.canDelegateToAgents ?? false,
        maxConcurrent: body.maxConcurrent ?? 1,
        owner: AgentOwner.USER,
        persistent,
        createdBy: 'api',
        createdAt: new Date().toISOString(),
        systemPrompt: body.systemPrompt,
        backend: body.backend,
        sessionId: persistent ? crypto.randomUUID() : undefined,
      };

      const process = await pool.create(definition);
      return jsonResponse(process.toRuntimeInfo(), 201);
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: update handler validates many optional fields
    update: async (req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Agent id is required');

      const agent = pool.get(id);
      if (!agent) throw new NotFoundError(`Agent "${id}" not found`);

      const body = await parseJsonBody<UpdateAgentRequest>(req);

      if (body.systemPrompt && body.systemPrompt.length > 100_000) {
        throw new ServerError('System prompt exceeds maximum length of 100,000 characters', 400);
      }

      // Validate backend if provided
      if (body.backend) {
        const validBackends = Object.values(AIBackend) as string[];
        if (!validBackends.includes(body.backend)) {
          throw new BadRequestError(
            `Invalid backend "${body.backend}". Valid: ${validBackends.join(', ')}`,
          );
        }
      }

      validateToolNames(body.tools);

      // Pick only defined fields from the request body
      const allowedFields = [
        'name',
        'role',
        'tools',
        'canModifyFiles',
        'canDelegateToAgents',
        'maxConcurrent',
        'persistent',
        'systemPrompt',
        'backend',
      ] as const;
      const updates: Partial<AgentDefinition> = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          (updates as Record<string, unknown>)[field] = body[field];
        }
      }

      const updated = await pool.update(id, updates);
      return jsonResponse(updated.toRuntimeInfo());
    },

    remove: async (_req: Request, params: RouteParams): Promise<Response> => {
      const { id } = params;
      if (!id) throw new BadRequestError('Agent id is required');

      const agent = pool.get(id);
      if (!agent) throw new NotFoundError(`Agent "${id}" not found`);

      // Use pool.remove() directly — the API request IS the user acting,
      // so conductor ownership permissions don't apply here.
      await pool.remove(id);
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
