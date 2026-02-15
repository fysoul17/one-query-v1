import { describe, expect, test } from 'bun:test';
import {
  BadRequestError,
  corsHeaders,
  createActivityRoute,
  createAgentRoutes,
  createConfigRoutes,
  createCronRoutes,
  createHealthRoute,
  createMemoryRoutes,
  createWebSocketHandler,
  errorResponse,
  handlePreflight,
  InternalError,
  jsonResponse,
  NotFoundError,
  parseEnvConfig,
  parseJsonBody,
  Router,
  ServerError,
} from '../src/index.ts';

describe('server smoke tests', () => {
  test('package is importable', () => {
    expect(true).toBe(true);
  });

  test('exports error classes', () => {
    expect(ServerError).toBeDefined();
    expect(BadRequestError).toBeDefined();
    expect(NotFoundError).toBeDefined();
    expect(InternalError).toBeDefined();
  });

  test('exports Router', () => {
    expect(Router).toBeDefined();
    const router = new Router();
    expect(typeof router.get).toBe('function');
    expect(typeof router.post).toBe('function');
    expect(typeof router.put).toBe('function');
    expect(typeof router.delete).toBe('function');
    expect(typeof router.handle).toBe('function');
  });

  test('exports parseEnvConfig', () => {
    expect(typeof parseEnvConfig).toBe('function');
  });

  test('exports middleware helpers', () => {
    expect(typeof corsHeaders).toBe('function');
    expect(typeof jsonResponse).toBe('function');
    expect(typeof errorResponse).toBe('function');
    expect(typeof handlePreflight).toBe('function');
    expect(typeof parseJsonBody).toBe('function');
  });

  test('exports route factories', () => {
    expect(typeof createWebSocketHandler).toBe('function');
    expect(typeof createHealthRoute).toBe('function');
    expect(typeof createAgentRoutes).toBe('function');
    expect(typeof createMemoryRoutes).toBe('function');
    expect(typeof createCronRoutes).toBe('function');
    expect(typeof createActivityRoute).toBe('function');
    expect(typeof createConfigRoutes).toBe('function');
  });
});
