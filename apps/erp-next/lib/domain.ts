export type EntityId = string;
export type ISODateTime = string;
export type Money = { amount: number; currency: 'AWG' | 'USD' | string };

export type UserRole =
  | 'super_admin'
  | 'operations'
  | 'office_operator'
  | 'finance'
  | 'warehouse'
  | 'sales'
  | 'project_manager'
  | 'technician'
  | 'auditor';

export interface AuditFields {
  id: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy?: EntityId;
  updatedBy?: EntityId;
}

export interface Customer extends AuditFields {
  type: 'residential' | 'commercial' | 'enterprise' | 'government' | 'other';
  displayName: string;
  legalName?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  preferredLanguage?: 'en' | 'es' | 'pap' | 'nl' | string;
  avatarUrl?: string;
  status: 'lead' | 'active' | 'inactive' | 'on_hold';
  tags?: string[];
}

export interface Contact extends AuditFields {
  customerId: EntityId;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

export interface Site extends AuditFields {
  customerId: EntityId;
  name: string;
  address: string;
  gacCode?: string;
  operationalSector?: string;
  latitude?: number;
  longitude?: number;
  accessNotes?: string;
}

export interface Asset extends AuditFields {
  customerId: EntityId;
  siteId: EntityId;
  parentAssetId?: EntityId;
  assetType: 'split' | 'cassette' | 'floor_ceiling' | 'central' | 'vrf_outdoor' | 'vrf_indoor' | 'controller' | 'other';
  name: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  capacityBtu?: number;
  tonnage?: number;
  refrigerant?: string;
  voltage?: string;
  installedAt?: ISODateTime;
  warrantyUntil?: ISODateTime;
  qrCode?: string;
  status: 'active' | 'inactive' | 'replaced' | 'unknown';
}

export interface Lead extends AuditFields {
  customerId?: EntityId;
  source: 'whatsapp' | 'phone' | 'website' | 'referral' | 'walk_in' | 'social' | 'technician' | 'other';
  subject: string;
  ownerId?: EntityId;
  status: 'new' | 'contacted' | 'qualified' | 'nurture' | 'converted' | 'lost';
}

export interface Opportunity extends AuditFields {
  customerId: EntityId;
  siteId?: EntityId;
  sourceLeadId?: EntityId;
  subject: string;
  stage: 'qualified' | 'assessment' | 'estimating' | 'proposal_sent' | 'negotiation' | 'won' | 'lost';
  expectedValue?: Money;
  probability?: number;
  expectedCloseAt?: ISODateTime;
  ownerId?: EntityId;
}

export interface Estimate extends AuditFields {
  customerId: EntityId;
  siteId?: EntityId;
  opportunityId?: EntityId;
  status: 'draft' | 'review' | 'sent' | 'accepted' | 'declined' | 'expired';
  total: Money;
  version: number;
}

export interface Appointment extends AuditFields {
  customerId: EntityId;
  siteId: EntityId;
  workOrderId?: EntityId;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  status: 'temporary_hold' | 'confirmed' | 'cancelled' | 'rescheduled' | 'completed';
  primaryVanId?: EntityId;
  customerFacingDescription?: string;
  technicianInstructions?: string;
}

export interface WorkOrder extends AuditFields {
  customerId: EntityId;
  siteId: EntityId;
  appointmentId?: EntityId;
  projectId?: EntityId;
  type: 'service' | 'deep_cleaning' | 'diagnostic' | 'repair' | 'installation' | 'maintenance' | 'warranty' | 'callback' | 'project_task' | 'other';
  status: 'draft' | 'scheduled' | 'en_route' | 'on_site' | 'working' | 'waiting' | 'completed' | 'review_needed' | 'closed' | 'cancelled';
  readiness: 'ready' | 'at_risk' | 'blocked' | 'not_checked';
  assetIds: EntityId[];
  assignmentIds: EntityId[];
}

export interface WorkOrderAssignment extends AuditFields {
  workOrderId: EntityId;
  vanId: EntityId;
  technicianIds: EntityId[];
  isPrimary: boolean;
  customerCommunicationOwner: boolean;
}

export interface InventoryItem extends AuditFields {
  sku: string;
  name: string;
  classification:
    | 'consumable'
    | 'measured_consumable'
    | 'sellable_part'
    | 'serialized_part'
    | 'sellable_equipment'
    | 'tool'
    | 'ppe'
    | 'warranty_return';
  unitOfMeasure: string;
  trackQuantity: boolean;
  serialized: boolean;
  sellable: boolean;
  active: boolean;
}

export interface InventoryLocation extends AuditFields {
  name: string;
  type: 'warehouse' | 'van' | 'project_site' | 'staging' | 'quarantine' | 'showroom';
  active: boolean;
}

export interface InventoryTransaction extends AuditFields {
  itemId: EntityId;
  sourceLocationId?: EntityId;
  destinationLocationId?: EntityId;
  workOrderId?: EntityId;
  quantity: number;
  type: 'receipt' | 'transfer' | 'reservation' | 'issue' | 'consumption' | 'return' | 'adjustment' | 'scrap';
  requestedBy?: EntityId;
  approvedBy?: EntityId;
  issuedBy?: EntityId;
  receivedBy?: EntityId;
}

export interface Invoice extends AuditFields {
  customerId: EntityId;
  workOrderId?: EntityId;
  projectId?: EntityId;
  externalAccountingId?: string;
  invoiceNumber: string;
  status: 'draft' | 'open' | 'partially_paid' | 'paid' | 'overdue' | 'disputed' | 'void';
  total: Money;
  outstanding: Money;
  issuedAt: ISODateTime;
  dueAt?: ISODateTime;
}

export interface Payment extends AuditFields {
  customerId?: EntityId;
  bankTransactionId?: EntityId;
  amount: Money;
  receivedAt: ISODateTime;
  method: 'bank_transfer' | 'cash' | 'card' | 'other';
  status: 'detected' | 'unallocated' | 'partially_allocated' | 'allocated' | 'reversed';
}

export interface PaymentAllocation extends AuditFields {
  paymentId: EntityId;
  invoiceId: EntityId;
  amount: Money;
  confidence?: number;
  approvedBy?: EntityId;
}

export interface Conversation extends AuditFields {
  customerId?: EntityId;
  channel: 'whatsapp' | 'phone' | 'email' | 'web' | 'internal';
  ownerId?: EntityId;
  queue?: string;
  status: 'new' | 'assigned' | 'waiting_customer' | 'waiting_demac' | 'escalated' | 'resolved' | 'closed';
  aiMode: 'off' | 'assist' | 'routine_auto';
}

export interface CommunicationCase extends AuditFields {
  customerId: EntityId;
  conversationId?: EntityId;
  workOrderId?: EntityId;
  category: 'service' | 'sales' | 'payment' | 'complaint' | 'technical' | 'commercial' | 'other';
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'waiting' | 'resolved' | 'closed';
  ownerId?: EntityId;
}

export interface DocumentRecord extends AuditFields {
  customerId?: EntityId;
  workOrderId?: EntityId;
  vendorId?: EntityId;
  documentType: 'invoice' | 'receipt' | 'report' | 'photo' | 'audio' | 'contract' | 'statement' | 'other';
  storageKey: string;
  sha256?: string;
  retentionUntil?: ISODateTime;
}

export interface Alert extends AuditFields {
  severity: 'info' | 'opportunity' | 'warning' | 'critical';
  module: string;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: EntityId;
  resolvedAt?: ISODateTime;
}
