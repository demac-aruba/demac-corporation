import type { UserRole } from './domain';

export type NavigationItem = {
  label: string;
  href: string;
  short: string;
  roles: UserRole[];
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const allManagementRoles: UserRole[] = ['super_admin', 'operations', 'office_operator', 'finance', 'warehouse', 'sales', 'project_manager', 'auditor'];

export const navigationGroups: NavigationGroup[] = [
  {
    label: 'Operations',
    items: [
      { label: 'Command Center', href: '/dashboard', short: 'CC', roles: allManagementRoles },
      { label: 'KPIs', href: '/kpis', short: 'KP', roles: allManagementRoles },
      { label: 'Scheduling & Dispatch', href: '/scheduling', short: 'SD', roles: ['super_admin', 'operations', 'office_operator', 'project_manager'] },
      { label: 'Work Orders', href: '/work-orders', short: 'WO', roles: ['super_admin', 'operations', 'office_operator', 'project_manager'] },
      { label: 'Field App', href: '/field', short: 'FA', roles: ['super_admin', 'technician'] },
      { label: 'Technicians', href: '/technicians', short: 'TE', roles: ['super_admin', 'operations', 'project_manager'] },
    ],
  },
  {
    label: 'Customers',
    items: [
      { label: 'CRM', href: '/crm', short: 'CR', roles: ['super_admin', 'operations', 'office_operator', 'finance', 'sales', 'project_manager'] },
      { label: 'Leads', href: '/leads', short: 'LE', roles: ['super_admin', 'operations', 'office_operator', 'sales'] },
      { label: 'Opportunities', href: '/opportunities', short: 'OP', roles: ['super_admin', 'operations', 'office_operator', 'sales', 'project_manager'] },
      { label: 'Estimates', href: '/estimates', short: 'ES', roles: ['super_admin', 'operations', 'office_operator', 'sales', 'project_manager'] },
      { label: 'Maintenance', href: '/maintenance', short: 'MA', roles: ['super_admin', 'operations', 'office_operator', 'sales'] },
    ],
  },
  {
    label: 'Communications',
    items: [
      { label: 'Communication Center', href: '/communications', short: 'CO', roles: ['super_admin', 'operations', 'office_operator', 'sales'] },
      { label: 'AI Customer Agent', href: '/customer-ai', short: 'AI', roles: ['super_admin', 'operations'] },
      { label: 'Escalations', href: '/escalations', short: 'EC', roles: ['super_admin', 'operations', 'office_operator'] },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Warehouse', href: '/inventory', short: 'WH', roles: ['super_admin', 'operations', 'warehouse'] },
      { label: 'Vans', href: '/vans', short: 'VA', roles: ['super_admin', 'operations', 'warehouse'] },
      { label: 'Purchasing', href: '/purchasing', short: 'PU', roles: ['super_admin', 'operations', 'warehouse', 'finance'] },
      { label: 'Tools', href: '/tools', short: 'TO', roles: ['super_admin', 'operations', 'warehouse'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Finance Center', href: '/finance', short: 'FI', roles: ['super_admin', 'finance'] },
      { label: 'Invoices', href: '/invoices', short: 'IN', roles: ['super_admin', 'finance', 'office_operator'] },
      { label: 'Payments', href: '/payments', short: 'PA', roles: ['super_admin', 'finance', 'office_operator'] },
      { label: 'Banking Monitor', href: '/banking', short: 'BK', roles: ['super_admin', 'finance'] },
      { label: 'Expenses & Budgets', href: '/expenses', short: 'EX', roles: ['super_admin', 'finance'] },
    ],
  },
  {
    label: 'Management',
    items: [
      { label: 'Employees', href: '/employees', short: 'EM', roles: ['super_admin', 'operations'] },
      { label: 'Projects', href: '/projects', short: 'PR', roles: ['super_admin', 'operations', 'project_manager', 'finance'] },
      { label: 'Reports', href: '/reports', short: 'RE', roles: ['super_admin', 'operations', 'finance', 'project_manager', 'auditor'] },
      { label: 'Executive AI', href: '/executive-ai', short: 'EA', roles: ['super_admin'] },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings', href: '/settings', short: 'ST', roles: ['super_admin'] },
      { label: 'Automations', href: '/automations', short: 'AU', roles: ['super_admin'] },
      { label: 'Integrations', href: '/integrations', short: 'IG', roles: ['super_admin'] },
      { label: 'Audit Log', href: '/audit', short: 'AL', roles: ['super_admin', 'auditor'] },
    ],
  },
];

export const foundationRole: UserRole = 'super_admin';
