import type { AuthPrincipal, Capability } from './security';

export type FieldResponsibility = 'lead' | 'technician' | 'helper';

export type FieldAssignmentMember = {
  staffId: string;
  responsibility: FieldResponsibility;
};

/**
 * Compatibility/test projection for one Work Order / Work Visit.
 * Canonical Field authorization is server-side in Field Operations Authority.
 * This shape remains useful for client regression tests while migration is in progress.
 */
export type FieldAssignmentScope = {
  workOrderId: string;
  members: readonly FieldAssignmentMember[];
  vanIds: readonly string[];
};

/**
 * Client-side Field API action contract only. The server remains authoritative for
 * deciding which of these actions are allowed for a principal on a specific job.
 */
export type FieldAllowedAction =
  | 'read'
  | 'execute'
  | 'report.edit'
  | 'evidence.add'
  | 'measurement.add'
  | 'finding.add'
  | 'asset.add'
  | 'intervention.add'
  | 'sale.propose'
  | 'intervention.complete'
  | 'visit.complete'
  | 'office.review'
  | 'price.override';

export type FieldAction = FieldAllowedAction;

export type FieldAuthorizationDecision = {
  allowed: boolean;
  reason?: string;
  responsibility?: FieldResponsibility;
};

function has(principal: AuthPrincipal, capability: Capability) {
  return principal.active && principal.capabilities.has(capability);
}

function memberForPrincipal(principal: AuthPrincipal, scope: FieldAssignmentScope) {
  if (!principal.staffId) return undefined;
  return scope.members.find((member) => member.staffId === principal.staffId);
}

function isAssignedForRead(principal: AuthPrincipal, scope: FieldAssignmentScope) {
  if (memberForPrincipal(principal, scope)) return true;
  return Boolean(principal.vanId && scope.vanIds.includes(principal.vanId));
}

function allowedResponsibilities(action: FieldAction): readonly FieldResponsibility[] {
  switch (action) {
    case 'report.edit':
    case 'evidence.add':
    case 'measurement.add':
    case 'finding.add':
      return ['lead', 'technician', 'helper'];
    case 'execute':
    case 'asset.add':
    case 'intervention.add':
    case 'sale.propose':
    case 'intervention.complete':
      return ['lead', 'technician'];
    case 'visit.complete':
      return ['lead'];
    default:
      return [];
  }
}

function capabilityForAction(action: FieldAction): Capability | null {
  switch (action) {
    case 'read': return 'field.read_assigned';
    case 'execute':
    case 'report.edit':
    case 'evidence.add':
    case 'measurement.add':
    case 'finding.add':
    case 'intervention.complete':
      return 'field.execute';
    case 'asset.add':
    case 'intervention.add':
      return 'field.scope.manage';
    case 'sale.propose': return 'field.sale.propose';
    case 'visit.complete': return 'field.complete';
    case 'office.review': return 'field.review';
    case 'price.override': return 'field.price.override';
  }
}

/**
 * Compatibility-only client projection. Do not use this function as authorization for
 * canonical writes. Future mutations must use server-projected allowedActions for UX and
 * Field Operations Authority must recalculate authorization before persisting anything.
 */
export function authorizeFieldAction(principal: AuthPrincipal, scope: FieldAssignmentScope, action: FieldAction): FieldAuthorizationDecision {
  if (!principal.active) return { allowed: false, reason: 'Principal is inactive.' };

  const capability = capabilityForAction(action);
  if (!capability || !has(principal, capability)) {
    return { allowed: false, reason: `Missing capability ${capability ?? 'unknown'}.` };
  }

  if (action === 'office.review' || action === 'price.override') return { allowed: true };

  if (!isAssignedForRead(principal, scope)) {
    return { allowed: false, reason: `Principal is not assigned to Work Order ${scope.workOrderId}.` };
  }

  if (action === 'read') return { allowed: true, responsibility: memberForPrincipal(principal, scope)?.responsibility };

  const member = memberForPrincipal(principal, scope);
  if (!member) {
    return {
      allowed: false,
      reason: 'Field mutations require explicit staff membership; van-only fallback is read-only.',
    };
  }

  const responsibilities = allowedResponsibilities(action);
  if (!responsibilities.includes(member.responsibility)) {
    return {
      allowed: false,
      reason: `${member.responsibility} is not authorized for field action ${action}.`,
      responsibility: member.responsibility,
    };
  }

  return { allowed: true, responsibility: member.responsibility };
}

export function requireFieldAction(principal: AuthPrincipal, scope: FieldAssignmentScope, action: FieldAction) {
  const decision = authorizeFieldAction(principal, scope, action);
  if (!decision.allowed) throw new Error(`Forbidden: ${action}. ${decision.reason ?? ''}`.trim());
  return decision;
}

/**
 * Compatibility query-boundary helper for client tests/preview only.
 * Production Field reads are assignment-scoped by Field Operations Authority.
 */
export function filterAssignedFieldScopes(principal: AuthPrincipal, scopes: readonly FieldAssignmentScope[]) {
  return scopes.filter((scope) => authorizeFieldAction(principal, scope, 'read').allowed);
}
