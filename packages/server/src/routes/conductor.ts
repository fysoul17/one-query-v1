import type { Conductor } from '@autonomy/conductor';
import { isPromptSafe } from '@autonomy/conductor';
import { BadRequestError } from '../errors.ts';
import { jsonResponse, parseJsonBody } from '../middleware.ts';

const MAX_NAME_LENGTH = 50;
const MAX_TRAITS_LENGTH = 500;
const VALID_STYLES = ['professional', 'casual', 'concise', 'formal', 'friendly'];

export function createConductorRoutes(conductor: Conductor) {
  return {
    getSettings: async (): Promise<Response> => {
      return jsonResponse({
        personality: conductor.personality,
        conductorName: conductor.conductorName,
        sessionId: conductor.sessionId,
        pendingQuestions: conductor.pendingQuestions,
      });
    },

    updateSettings: async (req: Request): Promise<Response> => {
      const body = await parseJsonBody<{
        personality?: { name?: string; communicationStyle?: string; traits?: string };
      }>(req);

      if (!body.personality) {
        throw new BadRequestError('personality is required');
      }

      const { name, communicationStyle, traits } = body.personality;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new BadRequestError('personality.name is required and must be non-empty');
      }
      if (name.length > MAX_NAME_LENGTH) {
        throw new BadRequestError(`personality.name must be ${MAX_NAME_LENGTH} characters or less`);
      }

      if (communicationStyle && !VALID_STYLES.includes(communicationStyle)) {
        throw new BadRequestError(
          `personality.communicationStyle must be one of: ${VALID_STYLES.join(', ')}`,
        );
      }

      if (traits && traits.length > MAX_TRAITS_LENGTH) {
        throw new BadRequestError(
          `personality.traits must be ${MAX_TRAITS_LENGTH} characters or less`,
        );
      }

      // Validate personality fields against prompt injection blocklist
      if (!isPromptSafe(name)) {
        throw new BadRequestError('personality.name contains disallowed content');
      }
      if (traits && !isPromptSafe(traits)) {
        throw new BadRequestError('personality.traits contains disallowed content');
      }

      conductor.updatePersonality({
        name: name.trim(),
        communicationStyle,
        traits: traits?.trim(),
      });

      return jsonResponse({
        success: true,
        personality: conductor.personality,
      });
    },
  };
}
