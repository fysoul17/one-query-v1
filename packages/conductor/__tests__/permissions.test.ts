import { describe, expect, test } from 'bun:test';
import { AgentOwner, ConductorAction, ConductorTarget } from '@autonomy/shared';
import { ApprovalRequiredError, PermissionDeniedError } from '../src/errors.ts';
import { PermissionChecker } from '../src/permissions.ts';

describe('PermissionChecker', () => {
  const checker = new PermissionChecker();

  describe('resolveTarget', () => {
    test('maps CONDUCTOR owner to OWN_AGENT target', () => {
      expect(checker.resolveTarget(AgentOwner.CONDUCTOR)).toBe(ConductorTarget.OWN_AGENT);
    });

    test('maps USER owner to USER_AGENT target', () => {
      expect(checker.resolveTarget(AgentOwner.USER)).toBe(ConductorTarget.USER_AGENT);
    });

    test('maps SYSTEM owner to SELF target', () => {
      expect(checker.resolveTarget(AgentOwner.SYSTEM)).toBe(ConductorTarget.SELF);
    });

    test('defaults unknown owner to USER_AGENT', () => {
      expect(checker.resolveTarget('unknown')).toBe(ConductorTarget.USER_AGENT);
    });
  });

  describe('check — OWN_AGENT (conductor-created)', () => {
    test('allows create', () => {
      const result = checker.check(ConductorTarget.OWN_AGENT, ConductorAction.CREATE);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    test('allows modify', () => {
      const result = checker.check(ConductorTarget.OWN_AGENT, ConductorAction.MODIFY);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    test('allows delete', () => {
      const result = checker.check(ConductorTarget.OWN_AGENT, ConductorAction.DELETE);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    test('allows delegate', () => {
      const result = checker.check(ConductorTarget.OWN_AGENT, ConductorAction.DELEGATE);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('check — USER_AGENT (user-created)', () => {
    test('denies create', () => {
      const result = checker.check(ConductorTarget.USER_AGENT, ConductorAction.CREATE);
      expect(result.allowed).toBe(false);
    });

    test('allows modify but requires approval', () => {
      const result = checker.check(ConductorTarget.USER_AGENT, ConductorAction.MODIFY);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    test('allows delete but requires approval', () => {
      const result = checker.check(ConductorTarget.USER_AGENT, ConductorAction.DELETE);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    test('allows delegate without approval', () => {
      const result = checker.check(ConductorTarget.USER_AGENT, ConductorAction.DELEGATE);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    test('allows read without approval', () => {
      const result = checker.check(ConductorTarget.USER_AGENT, ConductorAction.READ);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('check — SELF (system-level)', () => {
    test('denies modify', () => {
      const result = checker.check(ConductorTarget.SELF, ConductorAction.MODIFY);
      expect(result.allowed).toBe(false);
    });

    test('denies delete', () => {
      const result = checker.check(ConductorTarget.SELF, ConductorAction.DELETE);
      expect(result.allowed).toBe(false);
    });

    test('allows read', () => {
      const result = checker.check(ConductorTarget.SELF, ConductorAction.READ);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('check — MEMORY', () => {
    test('allows read', () => {
      const result = checker.check(ConductorTarget.MEMORY, ConductorAction.READ);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    test('allows write', () => {
      const result = checker.check(ConductorTarget.MEMORY, ConductorAction.WRITE);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('check — CRON', () => {
    test('allows create', () => {
      const result = checker.check(ConductorTarget.CRON, ConductorAction.CREATE);
      expect(result.allowed).toBe(true);
    });

    test('allows delete', () => {
      const result = checker.check(ConductorTarget.CRON, ConductorAction.DELETE);
      expect(result.allowed).toBe(true);
    });
  });

  describe('enforce', () => {
    test('does not throw for allowed actions', () => {
      expect(() => {
        checker.enforce(ConductorTarget.OWN_AGENT, ConductorAction.CREATE);
      }).not.toThrow();
    });

    test('throws PermissionDeniedError for denied actions', () => {
      expect(() => {
        checker.enforce(ConductorTarget.SELF, ConductorAction.DELETE);
      }).toThrow(PermissionDeniedError);
    });

    test('throws ApprovalRequiredError for approval-gated actions', () => {
      expect(() => {
        checker.enforce(ConductorTarget.USER_AGENT, ConductorAction.MODIFY);
      }).toThrow(ApprovalRequiredError);
    });
  });

  describe('custom rules', () => {
    test('accepts custom rules instead of defaults', () => {
      const custom = new PermissionChecker([
        {
          target: ConductorTarget.OWN_AGENT,
          action: ConductorAction.CREATE,
          allowed: false,
          requiresApproval: false,
        },
      ]);
      const result = custom.check(ConductorTarget.OWN_AGENT, ConductorAction.CREATE);
      expect(result.allowed).toBe(false);
    });
  });

  describe('check — unknown rule', () => {
    test('returns denied for unknown target/action combo', () => {
      const custom = new PermissionChecker([]);
      const result = custom.check(ConductorTarget.OWN_AGENT, ConductorAction.CREATE);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No rule');
    });
  });
});
