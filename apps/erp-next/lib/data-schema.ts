export const collections = {
  users: 'users',
  customers: 'customers',
  contacts: 'contacts',
  sites: 'sites',
  assets: 'assets',
  leads: 'leads',
  opportunities: 'opportunities',
  estimates: 'estimates',
  appointments: 'appointments',
  workOrders: 'work_orders',
  workOrderAssignments: 'work_order_assignments',
  fieldReports: 'field_reports',
  inventoryItems: 'inventory_items',
  inventoryLocations: 'inventory_locations',
  inventoryTransactions: 'inventory_transactions',
  inventoryBalances: 'inventory_balances',
  tools: 'tools',
  purchaseOrders: 'purchase_orders',
  vendors: 'vendors',
  invoices: 'invoices',
  payments: 'payments',
  paymentAllocations: 'payment_allocations',
  bankTransactions: 'bank_transactions',
  expenses: 'expenses',
  projects: 'projects',
  employees: 'employees',
  conversations: 'conversations',
  communicationCases: 'communication_cases',
  messages: 'messages',
  documents: 'documents',
  alerts: 'alerts',
  automations: 'automations',
  settings: 'settings',
  integrationStates: 'integration_states',
  auditEvents: 'audit_events',
} as const;

export type CollectionKey = keyof typeof collections;
export type CollectionName = (typeof collections)[CollectionKey];

export const immutableCollections: CollectionName[] = [
  collections.inventoryTransactions,
  collections.paymentAllocations,
  collections.bankTransactions,
  collections.auditEvents,
];

export const sensitiveCollections: CollectionName[] = [
  collections.users,
  collections.employees,
  collections.bankTransactions,
  collections.payments,
  collections.paymentAllocations,
  collections.settings,
  collections.integrationStates,
  collections.auditEvents,
];

export type DataEnvironment = 'preview' | 'development' | 'production';

export type RuntimeDataConfig = {
  environment: DataEnvironment;
  provider: 'preview' | 'firebase';
  projectId?: string;
  writesEnabled: boolean;
  externalWritesEnabled: boolean;
};

export const previewDataConfig: RuntimeDataConfig = {
  environment: 'preview',
  provider: 'preview',
  writesEnabled: false,
  externalWritesEnabled: false,
};
