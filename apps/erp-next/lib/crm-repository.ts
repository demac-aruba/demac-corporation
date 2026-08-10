import type { Asset, Contact, Customer, EntityId, Invoice, Opportunity, Payment, Site, WorkOrder } from './domain';

export type CustomerTimelineEvent = {
  id: EntityId;
  customerId: EntityId;
  occurredAt: string;
  type: 'communication' | 'appointment' | 'work_order' | 'estimate' | 'invoice' | 'payment' | 'document' | 'note' | 'opportunity';
  title: string;
  description?: string;
  relatedEntityId?: EntityId;
};

export type Customer360Snapshot = {
  customer: Customer;
  contacts: Contact[];
  sites: Site[];
  assets: Asset[];
  openWorkOrders: WorkOrder[];
  openOpportunities: Opportunity[];
  openInvoices: Invoice[];
  recentPayments: Payment[];
  timeline: CustomerTimelineEvent[];
};

export interface CrmRepository {
  searchCustomers(query: string, options?: { limit?: number; status?: Customer['status']; type?: Customer['type'] }): Promise<Customer[]>;
  getCustomer360(customerId: EntityId): Promise<Customer360Snapshot | null>;
  createCustomer(input: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer>;
  updateCustomer(customerId: EntityId, patch: Partial<Customer>): Promise<Customer>;
  mergeCustomers(primaryCustomerId: EntityId, duplicateCustomerId: EntityId): Promise<void>;
}

// Firebase or another provider will implement this contract later.
// UI components must consume this repository/service boundary rather than importing provider-specific SDKs directly.
