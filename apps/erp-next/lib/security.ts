import type { EntityId, UserRole } from './domain';

export type Capability =
  | 'dashboard.view'
  | 'kpi.view'
  | 'crm.view' | 'crm.manage'
  | 'sales.view' | 'sales.manage'
  | 'scheduling.view' | 'scheduling.manage'
  | 'work_orders.view' | 'work_orders.manage'
  | 'field.read_assigned'
  | 'field.execute'
  | 'field.scope.manage'
  | 'field.sale.propose'
  | 'field.complete'
  | 'field.review'
  | 'field.price.override'
  | 'communications.view' | 'communications.reply' | 'communications.manage'
  | 'inventory.view' | 'inventory.manage' | 'inventory.approve'
  | 'purchasing.view' | 'purchasing.manage' | 'purchasing.approve'
  | 'finance.view' | 'finance.manage' | 'finance.approve'
  | 'banking.view' | 'banking.reconcile'
  | 'employees.view' | 'employees.manage' | 'payroll_sensitive.view'
  | 'projects.view' | 'projects.manage'
  | 'reports.view'
  | 'executive_ai.use'
  | 'website.manage'
  | 'settings.view' | 'settings.manage'
  | 'automations.view' | 'automations.manage'
  | 'integrations.view' | 'integrations.manage'
  | 'audit.view'
  | 'security.manage';

export interface AuthPrincipal {
  userId: EntityId;
  displayName: string;
  role: UserRole;
  active: boolean;
  /** Canonical staffProfiles document id. Required for technician field assignment authorization. */
  staffId?: EntityId;
  /** Canonical van id from the provisioned user profile; daily assignment remains authoritative when resolved server-side. */
  vanId?: EntityId;
  capabilities: ReadonlySet<Capability>;
}

const capabilities = (...values: Capability[]) => new Set(values);

export const roleCapabilities: Record<UserRole, ReadonlySet<Capability>> = {
  super_admin: capabilities(
    'dashboard.view','kpi.view','crm.view','crm.manage','sales.view','sales.manage','scheduling.view','scheduling.manage',
    'work_orders.view','work_orders.manage','field.read_assigned','field.execute','field.scope.manage','field.sale.propose','field.complete','field.review','field.price.override',
    'communications.view','communications.reply','communications.manage','inventory.view','inventory.manage','inventory.approve','purchasing.view','purchasing.manage','purchasing.approve',
    'finance.view','finance.manage','finance.approve','banking.view','banking.reconcile','employees.view','employees.manage',
    'payroll_sensitive.view','projects.view','projects.manage','reports.view','executive_ai.use','website.manage','settings.view','settings.manage',
    'automations.view','automations.manage','integrations.view','integrations.manage','audit.view','security.manage',
  ),
  operations: capabilities(
    'dashboard.view','kpi.view','crm.view','crm.manage','sales.view','scheduling.view','scheduling.manage','work_orders.view',
    'work_orders.manage','field.read_assigned','field.review','field.price.override','communications.view','communications.reply','communications.manage','inventory.view','purchasing.view',
    'employees.view','employees.manage','projects.view','projects.manage','reports.view',
  ),
  office_operator: capabilities(
    'dashboard.view','kpi.view','crm.view','crm.manage','sales.view','sales.manage','scheduling.view','scheduling.manage',
    'work_orders.view','work_orders.manage','field.read_assigned','field.review','communications.view','communications.reply','finance.view','reports.view',
  ),
  finance: capabilities(
    'dashboard.view','kpi.view','crm.view','purchasing.view','purchasing.approve','finance.view','finance.manage','finance.approve',
    'banking.view','banking.reconcile','payroll_sensitive.view','projects.view','reports.view','audit.view',
  ),
  warehouse: capabilities(
    'dashboard.view','kpi.view','inventory.view','inventory.manage','inventory.approve','purchasing.view','purchasing.manage','reports.view',
  ),
  sales: capabilities('dashboard.view','crm.view','crm.manage','sales.view','sales.manage','communications.view','communications.reply','reports.view'),
  project_manager: capabilities(
    'dashboard.view','kpi.view','crm.view','sales.view','scheduling.view','scheduling.manage','work_orders.view','work_orders.manage',
    'inventory.view','purchasing.view','projects.view','projects.manage','reports.view',
  ),
  technician: capabilities('work_orders.view','field.read_assigned','field.execute','field.scope.manage','field.sale.propose','field.complete'),
  auditor: capabilities('dashboard.view','kpi.view','finance.view','reports.view','audit.view'),
};

export const roleLabels: Record<UserRole, string> = {
  super_admin: 'Owner / Super Admin',
  operations: 'Operations',
  office_operator: 'Office Operator',
  finance: 'Finance',
  warehouse: 'Warehouse',
  sales: 'Sales',
  project_manager: 'Project Manager',
  technician: 'Technician',
  auditor: 'Auditor',
};

export function can(role: UserRole, capability: Capability): boolean {
  return roleCapabilities[role].has(capability);
}

export function requireCapability(principal: AuthPrincipal, capability: Capability): void {
  if (!principal.active || !principal.capabilities.has(capability)) {
    throw new Error(`Forbidden: ${capability}`);
  }
}

export const previewPrincipal: AuthPrincipal = {
  userId: 'preview-owner',
  displayName: 'Christian',
  role: 'super_admin',
  active: true,
  capabilities: roleCapabilities.super_admin,
};