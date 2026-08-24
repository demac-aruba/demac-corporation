import type { UserRole } from './domain';
import {
  can as canCanonical,
  requireCapability as requireCanonicalCapability,
  roleCapabilities as canonicalRoleCapabilities,
  type AuthPrincipal,
  type Capability as CanonicalCapability,
} from './security';

/**
 * @deprecated Compatibility vocabulary for older ERP Next consumers.
 * `lib/security.ts` is the only authorization source of truth. Do not add permissions here.
 */
export type Capability =
  | 'dashboard.read'
  | 'crm.read'
  | 'crm.customer.edit'
  | 'crm.customer.merge'
  | 'crm.contact.manage'
  | 'crm.site.manage'
  | 'crm.asset.manage'
  | 'crm.timeline.note'
  | 'crm.opportunity.manage'
  | 'crm.financial_summary.read'
  | 'scheduling.read'
  | 'scheduling.manage'
  | 'work_orders.read'
  | 'work_orders.manage'
  | 'communications.read'
  | 'communications.manage'
  | 'inventory.read'
  | 'inventory.manage'
  | 'finance.summary.read'
  | 'finance.full'
  | 'projects.read'
  | 'projects.manage'
  | 'employees.read'
  | 'employees.manage'
  | 'executive_ai.use'
  | 'settings.manage'
  | 'audit.read';

export const legacyCapabilityToCanonical: Readonly<Record<Capability, CanonicalCapability>> = {
  'dashboard.read': 'dashboard.view',
  'crm.read': 'crm.view',
  'crm.customer.edit': 'crm.manage',
  'crm.customer.merge': 'crm.manage',
  'crm.contact.manage': 'crm.manage',
  'crm.site.manage': 'crm.manage',
  'crm.asset.manage': 'crm.manage',
  'crm.timeline.note': 'crm.manage',
  'crm.opportunity.manage': 'crm.manage',
  'crm.financial_summary.read': 'finance.view',
  'scheduling.read': 'scheduling.view',
  'scheduling.manage': 'scheduling.manage',
  'work_orders.read': 'work_orders.view',
  'work_orders.manage': 'work_orders.manage',
  'communications.read': 'communications.view',
  'communications.manage': 'communications.manage',
  'inventory.read': 'inventory.view',
  'inventory.manage': 'inventory.manage',
  'finance.summary.read': 'finance.view',
  'finance.full': 'finance.manage',
  'projects.read': 'projects.view',
  'projects.manage': 'projects.manage',
  'employees.read': 'employees.view',
  'employees.manage': 'employees.manage',
  'executive_ai.use': 'executive_ai.use',
  'settings.manage': 'settings.manage',
  'audit.read': 'audit.view',
};

const legacyCapabilities = Object.keys(legacyCapabilityToCanonical) as Capability[];

/**
 * @deprecated Read-only projection generated from the canonical policy.
 * It is intentionally not an independent role matrix.
 */
export const roleCapabilities: Record<UserRole, readonly Capability[]> = Object.fromEntries(
  (Object.keys(canonicalRoleCapabilities) as UserRole[]).map((role) => [
    role,
    legacyCapabilities.filter((capability) => canCanonical(role, legacyCapabilityToCanonical[capability])),
  ]),
) as Record<UserRole, readonly Capability[]>;

export function hasCapability(role: UserRole, capability: Capability) {
  return canCanonical(role, legacyCapabilityToCanonical[capability]);
}

export function requireCapability(role: UserRole, capability: Capability) {
  const principal: AuthPrincipal = {
    userId: 'legacy-capability-adapter',
    displayName: 'Legacy capability adapter',
    role,
    active: true,
    capabilities: canonicalRoleCapabilities[role],
  };
  requireCanonicalCapability(principal, legacyCapabilityToCanonical[capability]);
}
