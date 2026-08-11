import type {
  Alert, Appointment, Asset, CommunicationCase, Contact, Conversation, Customer, DocumentRecord,
  Estimate, InventoryItem, InventoryLocation, InventoryTransaction, Invoice, Lead, Opportunity,
  Payment, PaymentAllocation, Site, WorkOrder, WorkOrderAssignment,
} from './domain';
import type { ReadRepository, WriteRepository } from './persistence';

export interface ErpRepositories {
  customers: WriteRepository<Customer>;
  contacts: WriteRepository<Contact>;
  sites: WriteRepository<Site>;
  assets: WriteRepository<Asset>;
  leads: WriteRepository<Lead>;
  opportunities: WriteRepository<Opportunity>;
  estimates: WriteRepository<Estimate>;
  appointments: WriteRepository<Appointment>;
  workOrders: WriteRepository<WorkOrder>;
  workOrderAssignments: WriteRepository<WorkOrderAssignment>;
  inventoryItems: WriteRepository<InventoryItem>;
  inventoryLocations: WriteRepository<InventoryLocation>;
  inventoryTransactions: ReadRepository<InventoryTransaction>;
  invoices: WriteRepository<Invoice>;
  payments: ReadRepository<Payment>;
  paymentAllocations: ReadRepository<PaymentAllocation>;
  conversations: WriteRepository<Conversation>;
  communicationCases: WriteRepository<CommunicationCase>;
  documents: ReadRepository<DocumentRecord>;
  alerts: WriteRepository<Alert>;
}

export type RepositoryProvider = 'preview' | 'firebase';

export type RepositoryRegistry = {
  provider: RepositoryProvider;
  repositories: ErpRepositories;
};
