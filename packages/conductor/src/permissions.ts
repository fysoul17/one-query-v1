import {
  AgentOwner,
  ConductorAction,
  type ConductorPermissionRule,
  ConductorTarget,
} from '@autonomy/shared';
import { ApprovalRequiredError, PermissionDeniedError } from './errors.ts';
import type { PermissionCheckResult } from './types.ts';

const PERMISSION_RULES: ConductorPermissionRule[] = [
  // Conductor's own agents — full access
  {
    target: ConductorTarget.OWN_AGENT,
    action: ConductorAction.CREATE,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.OWN_AGENT,
    action: ConductorAction.MODIFY,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.OWN_AGENT,
    action: ConductorAction.DELETE,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.OWN_AGENT,
    action: ConductorAction.DELEGATE,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.OWN_AGENT,
    action: ConductorAction.READ,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.OWN_AGENT,
    action: ConductorAction.WRITE,
    allowed: true,
    requiresApproval: false,
  },

  // User-created agents — read/delegate freely, modify/delete requires approval
  {
    target: ConductorTarget.USER_AGENT,
    action: ConductorAction.CREATE,
    allowed: false,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.USER_AGENT,
    action: ConductorAction.MODIFY,
    allowed: true,
    requiresApproval: true,
  },
  {
    target: ConductorTarget.USER_AGENT,
    action: ConductorAction.DELETE,
    allowed: true,
    requiresApproval: true,
  },
  {
    target: ConductorTarget.USER_AGENT,
    action: ConductorAction.DELEGATE,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.USER_AGENT,
    action: ConductorAction.READ,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.USER_AGENT,
    action: ConductorAction.WRITE,
    allowed: true,
    requiresApproval: false,
  },

  // Self — cannot modify or delete itself
  {
    target: ConductorTarget.SELF,
    action: ConductorAction.CREATE,
    allowed: false,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.SELF,
    action: ConductorAction.MODIFY,
    allowed: false,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.SELF,
    action: ConductorAction.DELETE,
    allowed: false,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.SELF,
    action: ConductorAction.DELEGATE,
    allowed: false,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.SELF,
    action: ConductorAction.READ,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.SELF,
    action: ConductorAction.WRITE,
    allowed: false,
    requiresApproval: false,
  },

  // Memory — full access
  {
    target: ConductorTarget.MEMORY,
    action: ConductorAction.READ,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.MEMORY,
    action: ConductorAction.WRITE,
    allowed: true,
    requiresApproval: false,
  },

  // Cron — full access
  {
    target: ConductorTarget.CRON,
    action: ConductorAction.CREATE,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.CRON,
    action: ConductorAction.MODIFY,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.CRON,
    action: ConductorAction.DELETE,
    allowed: true,
    requiresApproval: false,
  },
  {
    target: ConductorTarget.CRON,
    action: ConductorAction.READ,
    allowed: true,
    requiresApproval: false,
  },
];

export class PermissionChecker {
  private rules: ConductorPermissionRule[];

  constructor(customRules?: ConductorPermissionRule[]) {
    this.rules = customRules ?? PERMISSION_RULES;
  }

  resolveTarget(agentOwner: string): ConductorTarget {
    switch (agentOwner) {
      case AgentOwner.CONDUCTOR:
        return ConductorTarget.OWN_AGENT;
      case AgentOwner.USER:
        return ConductorTarget.USER_AGENT;
      case AgentOwner.SYSTEM:
        return ConductorTarget.SELF;
      default:
        return ConductorTarget.USER_AGENT;
    }
  }

  check(target: ConductorTarget, action: ConductorAction): PermissionCheckResult {
    const rule = this.rules.find((r) => r.target === target && r.action === action);

    if (!rule) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `No rule for ${action} on ${target}`,
      };
    }

    if (!rule.allowed) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `${action} on ${target} is not allowed`,
      };
    }

    if (rule.requiresApproval) {
      return {
        allowed: true,
        requiresApproval: true,
        reason: `${action} on ${target} requires user approval`,
      };
    }

    return { allowed: true, requiresApproval: false, reason: `${action} on ${target} is allowed` };
  }

  enforce(target: ConductorTarget, action: ConductorAction): void {
    const result = this.check(target, action);

    if (!result.allowed) {
      throw new PermissionDeniedError(action, target, result.reason);
    }

    if (result.requiresApproval) {
      throw new ApprovalRequiredError(action, target);
    }
  }
}
