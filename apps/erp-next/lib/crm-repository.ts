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

export type DuplicateCustomerCandidate = {
  customer: Customer;
  matchedOn: Array<'displayName' | 'phone' | 'email'>;
  confidence: 'high' | 'medium' | 'low';
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
  findDuplicateCustomers(identity: { displayName?: string; primaryPhone?: string; primaryEmail?: string }, excludeCustomerId?: EntityId): Promise<DuplicateCustomerCandidate[]>;

  createCustomer(input: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer>;
  updateCustomer(customerId: EntityId, patch: Partial<Customer>): Promise<Customer>;
  mergeCustomers(primaryCustomerId: EntityId, duplicateCustomerId: EntityId): Promise<void>;

  createContact(input: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact>;
  updateContact(contactId: EntityId, patch: Partial<Contact>): Promise<Contact>;
  archiveContact(contactId: EntityId): Promise<void>;

  createSite(input: Omit<Site, 'id' | 'createdAt' | 'updatedAt'>): Promise<Site>;
  updateSite(siteId: EntityId, patch: Partial<Site>): Promise<Site>;
  archiveSite(siteId: EntityId): Promise<void>;

  createAsset(input: Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>): Promise<Asset>;
  updateAsset(assetId: EntityId, patch: Partial<Asset>): Promise<Asset>;
  archiveAsset(assetId: EntityId): Promise<void>;
}

// Firebase or another provider will implement this contract later.
// UI components consume this repository/service boundary rather than provider-specific SDK shapes.
// Destructive deletes are intentionally absent from CRM master data. Merge/archive preserve history and auditability.
