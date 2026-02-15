import { describe, expect, test } from 'bun:test';
import {
  ActivityLog,
  ApprovalRequiredError,
  Conductor,
  ConductorError,
  ConductorNotInitializedError,
  DelegationError,
  defaultRouter,
  PermissionChecker,
  PermissionDeniedError,
  RouterManager,
  RoutingError,
} from '../src/index.ts';

describe('conductor smoke tests', () => {
  test('package is importable', () => {
    expect(Conductor).toBeDefined();
  });

  test('all error classes are exported', () => {
    expect(ConductorError).toBeDefined();
    expect(ConductorNotInitializedError).toBeDefined();
    expect(PermissionDeniedError).toBeDefined();
    expect(ApprovalRequiredError).toBeDefined();
    expect(RoutingError).toBeDefined();
    expect(DelegationError).toBeDefined();
  });

  test('ActivityLog is exported and instantiable', () => {
    const log = new ActivityLog();
    expect(log).toBeDefined();
    expect(log.size).toBe(0);
  });

  test('PermissionChecker is exported and instantiable', () => {
    const checker = new PermissionChecker();
    expect(checker).toBeDefined();
  });

  test('RouterManager is exported and instantiable', () => {
    const manager = new RouterManager();
    expect(manager).toBeDefined();
  });

  test('defaultRouter is exported', () => {
    expect(typeof defaultRouter).toBe('function');
  });
});
