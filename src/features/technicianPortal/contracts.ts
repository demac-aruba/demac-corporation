export type TechnicianPortalRole = 'lead_technician' | 'technician' | 'helper' | 'supervisor' | 'office' | 'admin';

export type WorkVisitStatus =
  | 'not_started'
  | 'on_the_way'
  | 'on_site'
  | 'in_progress'
  | 'pending'
  | 'ready_for_office_review'
  | 'completed'
  | 'cancelled';

export type VisitUnitStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending'
  | 'completed'
  | 'not_accessible'
  | 'cancelled_by_client';

export type InterventionType =
  | 'standard_service'
  | 'deep_service'
  | 'repair'
  | 'installation'
  | 'diagnostic'
  | 'checkup';

export type InterventionStatus =
  | 'draft'
  | 'in_progress'
  | 'pending_authorization'
  | 'pending_part'
  | 'ready_for_review'
  | 'changes_requested'
  | 'completed'
  | 'cancelled';

export type ReportSectionType =
  | 'identification'
  | 'indoor'
  | 'outdoor'
  | 'electrical'
  | 'initial_measurements'
  | 'work_process'
  | 'final_measurements'
  | 'materials'
  | 'findings'
  | 'completion';

export type ReportSectionStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'not_applicable';

export type ScopeChangeOrigin = 'client_on_site' | 'technician_discovery' | 'office_update' | 'safety_requirement' | 'other';

export type ScopeChangeStatus =
  | 'no_approval_required'
  | 'pending_office_approval'
  | 'approved_by_office'
  | 'approved_by_client_on_site'
  | 'rejected'
  | 'quote_only';

export type ApprovalType = 'office' | 'client_on_site' | 'supervisor' | 'safety';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface AuditFields {
  createdAt: string;
  createdByUserId: string;
  createdByStaffId?: string;
  createdByName: string;
  updatedAt: string;
  updatedByUserId: string;
  updatedByStaffId?: string;
  updatedByName: string;
  version: number;
}

export interface WorkVisit extends AuditFields {
  id: string;
  workOrderId: string;
  clientId: string;
  propertyId?: string;
  scheduledScopeSnapshot: {
    serviceId?: string;
    serviceName?: string;
    estimatedUnitCount: number;
    problemDescription: string;
    technicianInstructions?: string;
  };
  status: WorkVisitStatus;
  leadTechnicianStaffId?: string;
  participatingStaffIds: string[];
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  receiverName?: string;
  requiresSecondVisit: boolean;
  secondVisitReason?: string;
}

export interface EquipmentComponent {
  id: string;
  componentType: 'indoor' | 'outdoor' | 'disconnect' | 'controller' | 'other';
  brand?: string;
  model?: string;
  serial?: string;
  btu?: number;
  refrigerant?: string;
  voltage?: string;
  nameplateEvidenceId?: string;
  notes?: string;
}

export interface EquipmentSystem extends AuditFields {
  id: string;
  qrCode: string;
  clientId: string;
  propertyId?: string;
  locationLabel: string;
  systemType: string;
  components: EquipmentComponent[];
  active: boolean;
  installedAt?: string;
  warrantyUntil?: string;
  condition?: string;
}

export interface VisitUnit extends AuditFields {
  id: string;
  visitId: string;
  workOrderId: string;
  equipmentSystemId?: string;
  sequence: number;
  locationLabel: string;
  source: 'scheduled' | 'existing_equipment' | 'qr_scan' | 'registered_on_site';
  status: VisitUnitStatus;
  addedOnSite: boolean;
  addedReason?: string;
  addedByStaffId?: string;
  completedAt?: string;
}

export interface WorkIntervention extends AuditFields {
  id: string;
  visitId: string;
  visitUnitId: string;
  equipmentSystemId?: string;
  type: InterventionType;
  templateId: string;
  templateVersion: number;
  isPrimary: boolean;
  status: InterventionStatus;
  requestedBy?: 'office' | 'client' | 'technician';
  scopeChangeId?: string;
  resultCode?: string;
  resultNotes?: string;
}

export interface ReportSectionLock {
  activeEditorUserId?: string;
  activeEditorStaffId?: string;
  activeEditorName?: string;
  acquiredAt?: string;
  expiresAt?: string;
}

export interface ReportSection extends AuditFields {
  id: string;
  visitId: string;
  visitUnitId: string;
  interventionId: string;
  sectionType: ReportSectionType;
  status: ReportSectionStatus;
  assignedToStaffId?: string;
  assignedToName?: string;
  fields: Record<string, string | number | boolean | null | string[]>;
  missingRequiredFieldKeys: string[];
  evidenceIds: string[];
  lock?: ReportSectionLock;
  completedAt?: string;
}

export interface ScopeChange extends AuditFields {
  id: string;
  visitId: string;
  visitUnitId?: string;
  interventionId?: string;
  origin: ScopeChangeOrigin;
  reason: string;
  previousScope?: string;
  proposedScope: string;
  status: ScopeChangeStatus;
  requestedAt: string;
  requestedByStaffId?: string;
  requestedByName: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
  resolvedByName?: string;
  resolutionNote?: string;
}

export interface VisitApproval extends AuditFields {
  id: string;
  visitId: string;
  visitUnitId?: string;
  interventionId?: string;
  scopeChangeId?: string;
  approvalType: ApprovalType;
  status: ApprovalStatus;
  requestedAt: string;
  requestedByName: string;
  decidedAt?: string;
  decidedByName?: string;
  decisionNote?: string;
  clientReceiverName?: string;
}

export interface TechnicianPortalPermissionSet {
  canAddVisitUnits: boolean;
  canRegisterEquipment: boolean;
  canChangeActualScope: boolean;
  canRequestScopeApproval: boolean;
  canApproveScopeChange: boolean;
  canEditAnySection: boolean;
  canSubmitVisitForReview: boolean;
  canApproveVisit: boolean;
}
