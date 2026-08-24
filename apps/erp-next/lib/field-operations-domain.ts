import type { AuditFields, EntityId, ISODateTime } from './domain';
import type { ReadRepository, WriteRepository } from './persistence';

export type WorkVisitStatus =
  | 'scheduled'
  | 'en_route'
  | 'on_site'
  | 'in_progress'
  | 'pending'
  | 'requires_return_visit'
  | 'ready_for_office_review'
  | 'completed'
  | 'no_access'
  | 'cancelled';

export type VisitAssetStatus =
  | 'identified'
  | 'in_progress'
  | 'completed'
  | 'pending'
  | 'not_performed';

export type VisitAssetSource =
  | 'scheduled'
  | 'existing_asset'
  | 'qr_scan'
  | 'registered_on_site';

export type WorkInterventionStatus =
  | 'planned'
  | 'confirmed'
  | 'in_progress'
  | 'pending_authorization'
  | 'pending_part'
  | 'not_performed'
  | 'declined'
  | 'cancelled'
  | 'completed';

export type WorkInterventionOrigin =
  | 'planned'
  | 'added_on_site_client_request'
  | 'added_on_site_technician_discovery'
  | 'converted_on_site'
  | 'office_added';

export type ScopeChangeOrigin =
  | 'client_requested_additional_work'
  | 'technician_discovered_additional_need'
  | 'office_updated_scope'
  | 'safety_requirement'
  | 'other';

export type PlannedWorkDispositionReason =
  | 'cancelled_by_customer'
  | 'not_accessible'
  | 'approved_deferral'
  | 'unsafe'
  | 'equipment_unavailable'
  | 'technician_determination'
  | 'other';

export type FieldSaleLineStatus =
  | 'proposed'
  | 'customer_approved'
  | 'installed'
  | 'delivered'
  | 'sold'
  | 'declined'
  | 'voided';

export type FieldApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type FieldApprovalMethod = 'signature' | 'verbal' | 'whatsapp' | 'email' | 'office_recorded' | 'other';

export type EvidenceMoment =
  | 'nameplate'
  | 'before'
  | 'during'
  | 'after'
  | 'finding'
  | 'gauge'
  | 'installation'
  | 'safety'
  | 'general';

export type EvidenceType = 'photo' | 'video' | 'audio' | 'document' | 'other';

export type FindingCategory =
  | 'dirt'
  | 'corrosion'
  | 'drainage'
  | 'electrical'
  | 'refrigerant'
  | 'installation'
  | 'physical_damage'
  | 'safety'
  | 'other';

export type FindingSeverity = 'info' | 'attention' | 'important' | 'critical';

export type FieldPriceSnapshot = {
  currency: 'AWG' | 'USD' | string;
  unitPrice: number;
  discountAmount?: number;
  taxAmount?: number;
  lineTotal?: number;
  sourceCatalogItemId?: EntityId;
  pricingVersion?: string | number;
  capturedAt: ISODateTime;
};

export type PlannedWorkLineSnapshot = {
  id: EntityId;
  schedulingWorkTypeId?: string;
  serviceCatalogItemId?: EntityId;
  description: string;
  quantity: number;
  estimatedDurationMinutes?: number;
  technicianInstructions?: string;
};

export type ScheduledScopeSnapshot = {
  appointmentId: EntityId;
  capturedAt: ISODateTime;
  estimatedUnitCount: number;
  workLines: PlannedWorkLineSnapshot[];
  customerFacingDescription?: string;
  technicianInstructions?: string;
};

export interface WorkVisit extends AuditFields {
  appointmentId: EntityId;
  workOrderId: EntityId;
  customerId: EntityId;
  /** Canonical CRM Property id. Existing siteId values are mapped to this at adapters. */
  propertyId: EntityId;
  scheduledScopeSnapshot: ScheduledScopeSnapshot;
  status: WorkVisitStatus;
  leadTechnicianStaffId?: EntityId;
  participatingStaffIds: EntityId[];
  departedAt?: ISODateTime;
  arrivedAt?: ISODateTime;
  startedAt?: ISODateTime;
  submittedAt?: ISODateTime;
  completedAt?: ISODateTime;
  requiresSecondVisit: boolean;
  secondVisitReason?: string;
  previousVisitId?: EntityId;
}

export interface VisitAsset extends AuditFields {
  visitId: EntityId;
  /** Canonical CRM Asset id. Must be resolved before final office submission. */
  assetId?: EntityId;
  sequence: number;
  locationLabel: string;
  source: VisitAssetSource;
  status: VisitAssetStatus;
  addedOnSite: boolean;
  addedReason?: string;
}

export interface WorkIntervention extends AuditFields {
  visitId: EntityId;
  visitAssetId: EntityId;
  /** Denormalized canonical CRM Asset id for projection/query convenience. */
  assetId?: EntityId;
  plannedWorkLineId?: EntityId;
  /** Canonical `services` catalog item id. */
  serviceCatalogItemId: EntityId;
  interventionType: string;
  origin: WorkInterventionOrigin;
  requestedBy?: 'office' | 'client' | 'technician';
  status: WorkInterventionStatus;
  templateId?: EntityId;
  templateVersion?: string | number;
  priceSnapshot?: FieldPriceSnapshot;
  scopeChangeId?: EntityId;
  startedAt?: ISODateTime;
  completedAt?: ISODateTime;
  performedByStaffIds: EntityId[];
  resultCode?: string;
  resultNotes?: string;
}

export interface ScopeChange extends AuditFields {
  visitId: EntityId;
  visitAssetId?: EntityId;
  interventionId?: EntityId;
  origin: ScopeChangeOrigin;
  reason: string;
  plannedWorkLineId?: EntityId;
  requestedByStaffId?: EntityId;
  requestedAt: ISODateTime;
  resolvedAt?: ISODateTime;
}

export interface PlannedWorkDisposition extends AuditFields {
  visitId: EntityId;
  plannedWorkLineId: EntityId;
  quantity: number;
  reason: PlannedWorkDispositionReason;
  note?: string;
  recordedByStaffId?: EntityId;
}

export interface FieldSaleLine extends AuditFields {
  visitId: EntityId;
  interventionId?: EntityId;
  assetId?: EntityId;
  /** Undefined only for controlled non-catalog lines. */
  catalogItemId?: EntityId;
  descriptionSnapshot: string;
  quantity: number;
  unit: string;
  priceSnapshot?: FieldPriceSnapshot;
  status: FieldSaleLineStatus;
  soldByStaffId: EntityId;
  requiresCustomerApproval: boolean;
  customerApprovalId?: EntityId;
  inventoryMovementId?: EntityId;
  invoiceLineId?: EntityId;
  nonCatalog: boolean;
  officeReviewRequired: boolean;
  notes?: string;
}

export type FieldApprovalReference =
  | { type: 'intervention'; id: EntityId }
  | { type: 'sale_line'; id: EntityId }
  | { type: 'scope_change'; id: EntityId };

export interface FieldApproval extends AuditFields {
  visitId: EntityId;
  status: FieldApprovalStatus;
  method: FieldApprovalMethod;
  affected: FieldApprovalReference[];
  receiverName: string;
  decidedAt?: ISODateTime;
  technicianStaffId?: EntityId;
  signatureEvidenceId?: EntityId;
  note?: string;
}

export interface FieldEvidence extends AuditFields {
  visitId: EntityId;
  visitAssetId?: EntityId;
  assetId?: EntityId;
  interventionId?: EntityId;
  reportSectionId?: EntityId;
  fieldKey?: string;
  evidenceType: EvidenceType;
  moment: EvidenceMoment;
  storageRef: string;
  technicianStaffId: EntityId;
  capturedAt: ISODateTime;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface FieldMeasurement extends AuditFields {
  visitId: EntityId;
  interventionId: EntityId;
  assetId: EntityId;
  metric: string;
  value: number | string;
  unit: string;
  moment: 'before' | 'during' | 'after' | 'diagnostic' | 'general';
  technicianStaffId: EntityId;
  measuredAt: ISODateTime;
}

export interface FieldFinding extends AuditFields {
  visitId: EntityId;
  assetId: EntityId;
  interventionId: EntityId;
  category: FindingCategory;
  severity: FindingSeverity;
  description: string;
  evidenceIds: EntityId[];
  recommendedAction?: string;
  createsFollowUp: boolean;
  createsEstimateOpportunity: boolean;
}

/**
 * Persistence boundary for canonical field truth. Concrete adapters must be server/Firebase
 * backed; browser storage is not an implementation of this production contract.
 */
export interface FieldOperationsRepositories {
  visits: WriteRepository<WorkVisit>;
  visitAssets: WriteRepository<VisitAsset>;
  interventions: WriteRepository<WorkIntervention>;
  scopeChanges: WriteRepository<ScopeChange>;
  plannedWorkDispositions: WriteRepository<PlannedWorkDisposition>;
  approvals: WriteRepository<FieldApproval>;
  saleLines: WriteRepository<FieldSaleLine>;
  evidence: WriteRepository<FieldEvidence>;
  measurements: WriteRepository<FieldMeasurement>;
  findings: WriteRepository<FieldFinding>;
}

export interface FieldOperationsReadRepositories {
  visits: ReadRepository<WorkVisit>;
  visitAssets: ReadRepository<VisitAsset>;
  interventions: ReadRepository<WorkIntervention>;
  scopeChanges: ReadRepository<ScopeChange>;
  plannedWorkDispositions: ReadRepository<PlannedWorkDisposition>;
  approvals: ReadRepository<FieldApproval>;
  saleLines: ReadRepository<FieldSaleLine>;
  evidence: ReadRepository<FieldEvidence>;
  measurements: ReadRepository<FieldMeasurement>;
  findings: ReadRepository<FieldFinding>;
}
