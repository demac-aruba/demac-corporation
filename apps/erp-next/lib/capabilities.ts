import type { UserRole } from './domain';

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

const allCapabilities: Capability[] = [
  'dashboard.read',
  'crm.read',
  'crm.customer.edit',
  'crm.customer.merge',
  'crm.contact.manage',
  'crm.site.manage',
  'crm.asset.manage',
  'crm.timeline.note',
  'crm.opportunity.manage',
  'crm.financial_summary.read',
  'scheduling.read',
  'scheduling.manage',
  'work_orders.read',
  'work_orders.manage',
  'communications.read',
  'communications.manage',
  'inventory.read',
  'inventory.manage',
  'finance.summary.read',
  'finance.full',
  'projects.read',
  'projects.manage',
  'employees.read',
  'employees.manage',
  'executive_ai.use',
  'settings.manage',
  'audit.read',
];

export const roleCapabilities: Record<UserRole, readonly Capability[]> = {
  super_admin: allCapabilities,
  operations: [
    'dashboard.read', 'crm.read', 'crm.customer.edit', 'crm.contact.manage', 'crm.site.manage', 'crm.asset.manage',
    'crm.timeline.note', 'crm.opportunity.manage', 'crm.financial_summary.read', 'scheduling.read', 'scheduling.manage',
    'work_orders.read', 'work_orders.manage', 'communications.read', 'communications.manage', 'inventory.read',
    'finance.summary.read', 'projects.read', 'employees.read',
  ],
  office_operator: [
    'dashboard.read', 'crm.read', 'crm.customer.edit', 'crm.contact.manage', 'crm.site.manage', 'crm.asset.manage',
    'crm.timeline.note', 'crm.opportunity.manage', 'crm.financial_summary.read', 'scheduling.read', 'scheduling.manage',
    'work_orders.read', 'work_orders.manage', 'communications.read', 'communications.manage', 'finance.summary.read',
  ],
  finance: [
    'dashboard.read', 'crm.read', 'crm.financial_summary.read', 'finance.summary.read', 'finance.full', 'audit.read',
  ],
  warehouse: [
    'dashboard.read', 'crm.read', 'work_orders.read', 'inventory.read', 'inventory.manage',
  ],
  sales: [
    'dashboard.read', 'crm.read', 'crm.customer.edit', 'crm.contact.manage', 'crm.site.manage', 'crm.timeline.note',
    'crm.opportunity.manage', 'crm.financial_summary.read', 'communications.read', 'finance.summary.read',
  ],
  project_manager: [
    'dashboard.read', 'crm.read', 'crm.contact.manage', 'crm.site.manage', 'crm.asset.manage', 'crm.timeline.note',
    'crm.opportunity.manage', 'crm.financial_summary.read', 'scheduling.read', 'work_orders.read', 'work_orders.manage',
    'inventory.read', 'finance.summary.read', 'projects.read', 'projects.manage',
  ],
  technician: ['crm.read', 'work_orders.read', 'inventory.read'],
  auditor: ['dashboard.read', 'crm.read', 'crm.financial_summary.read', 'finance.summary.read', 'audit.read'],
};

export function hasCapability(role: UserRole, capability: Capability) {
  return roleCapabilities[role].includes(capability);
}

export function requireCapability(role: UserRole, capability: Capability) {
  if (!hasCapability(role, capability)) {
    throw new Error(`Role ${role} is not allowed to use capability ${capability}.`);
  }
}

// Permission decisions belong to the application/domain boundary, not to visual hiding alone.
// Firebase rules, API authorization and UI affordances must eventually enforce the same capability policy.
