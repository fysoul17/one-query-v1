import { beforeEach, describe, expect, test } from 'bun:test';
import type { Conductor } from '@autonomy/conductor';
import { createConductorRoutes } from '../../src/routes/conductor.ts';
import { MockConductor } from '../helpers/mock-conductor.ts';

// Extend MockConductor with conductor soul features
class MockConductorWithSoul extends MockConductor {
  private _personality: { name: string; communicationStyle?: string; traits?: string } | undefined;
  private _sessionId = 'mock-session-123';

  get personality() {
    return this._personality;
  }

  get conductorName(): string {
    return this._personality?.name ?? 'Conductor';
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get pendingQuestions() {
    return [];
  }

  updatePersonality(personality: { name: string; communicationStyle?: string; traits?: string }) {
    this._personality = personality;
  }
}

describe('Conductor settings routes', () => {
  let conductor: MockConductorWithSoul;
  let routes: ReturnType<typeof createConductorRoutes>;

  beforeEach(() => {
    conductor = new MockConductorWithSoul();
    conductor.initialized = true;
    routes = createConductorRoutes(conductor as unknown as Conductor);
  });

  describe('GET /api/conductor/settings', () => {
    test('returns default settings when no personality configured', async () => {
      const res = await routes.getSettings();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.conductorName).toBe('Conductor');
      expect(body.data.personality).toBeUndefined();
      expect(body.data.sessionId).toBe('mock-session-123');
      expect(body.data.pendingQuestions).toEqual([]);
    });

    test('returns configured personality after update', async () => {
      conductor.updatePersonality({ name: 'JARVIS', communicationStyle: 'formal' });
      const res = await routes.getSettings();
      const body = await res.json();
      expect(body.data.personality.name).toBe('JARVIS');
      expect(body.data.conductorName).toBe('JARVIS');
    });
  });

  describe('PUT /api/conductor/settings', () => {
    test('updates personality successfully', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({
          personality: { name: 'Friday', communicationStyle: 'casual', traits: 'Witty' },
        }),
      });
      const res = await routes.updateSettings(req);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.personality.name).toBe('Friday');
      expect(conductor.personality?.name).toBe('Friday');
    });

    test('rejects missing personality', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({}),
      });
      await expect(routes.updateSettings(req)).rejects.toThrow('personality is required');
    });

    test('rejects empty name', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({ personality: { name: '' } }),
      });
      await expect(routes.updateSettings(req)).rejects.toThrow('personality.name is required');
    });

    test('rejects name over 50 chars', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({ personality: { name: 'A'.repeat(51) } }),
      });
      await expect(routes.updateSettings(req)).rejects.toThrow('50 characters');
    });

    test('rejects invalid communication style', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({
          personality: { name: 'Test', communicationStyle: 'aggressive' },
        }),
      });
      await expect(routes.updateSettings(req)).rejects.toThrow('communicationStyle must be one of');
    });

    test('rejects traits over 500 chars', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({
          personality: { name: 'Test', traits: 'X'.repeat(501) },
        }),
      });
      await expect(routes.updateSettings(req)).rejects.toThrow('500 characters');
    });

    test('accepts valid communication styles', async () => {
      for (const style of ['professional', 'casual', 'concise', 'formal', 'friendly']) {
        const req = new Request('http://localhost/api/conductor/settings', {
          method: 'PUT',
          body: JSON.stringify({
            personality: { name: 'Test', communicationStyle: style },
          }),
        });
        const res = await routes.updateSettings(req);
        const body = await res.json();
        expect(body.success).toBe(true);
      }
    });

    test('trims name and traits whitespace', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({
          personality: { name: '  JARVIS  ', traits: '  Witty  ' },
        }),
      });
      const res = await routes.updateSettings(req);
      const body = await res.json();
      expect(body.data.personality.name).toBe('JARVIS');
      expect(body.data.personality.traits).toBe('Witty');
    });

    test('rejects name with blocklisted content', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({
          personality: { name: 'eval(' },
        }),
      });
      await expect(routes.updateSettings(req)).rejects.toThrow('disallowed content');
    });

    test('rejects traits with blocklisted content', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({
          personality: { name: 'Test', traits: 'Use process.env to get keys' },
        }),
      });
      await expect(routes.updateSettings(req)).rejects.toThrow('disallowed content');
    });

    test('personality without optional fields is valid', async () => {
      const req = new Request('http://localhost/api/conductor/settings', {
        method: 'PUT',
        body: JSON.stringify({
          personality: { name: 'Alfred' },
        }),
      });
      const res = await routes.updateSettings(req);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.personality.name).toBe('Alfred');
    });
  });
});
