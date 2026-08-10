export type WorkOrderLifecycleStatus =
  | 'draft'
  | 'scheduled'
  | 'en_route'
  | 'on_site'
  | 'working'
  | 'technician_complete'
  | 'office_review'
  | 'closed'
  | 'cancelled';

export type FieldReportStatus =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'ai_processing'
  | 'office_review'
  | 'approved'
  | 'delivered';

export type EvidenceType =
  | 'before_photo'
  | 'gauge_before'
  | 'after_photo'
  | 'gauge_after'
  | 'nameplate'
  | 'installation'
  | 'finding'
  | 'other';

export type Measurement = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  phase?: 'before' | 'after' | 'diagnostic';
};

export type EvidenceRecord = {
  id: string;
  workOrderId: string;
  assetId?: string;
  type: EvidenceType;
  label: string;
  capturedAt: string;
  capturedBy: string;
  thumbnailRef?: string;
  fullResolutionRef?: string;
};

export type EquipmentIntervention = {
  id: string;
  workOrderId: string;
  assetId: string;
  assetLabel: string;
  condition: 'good' | 'attention' | 'critical' | 'not_checked';
  findings: string[];
  actions: string[];
  measurements: Measurement[];
  evidenceIds: string[];
  nameplateAlreadyRegistered: boolean;
};

export type VoiceNoteRecord = {
  id: string;
  workOrderId: string;
  durationSeconds: number;
  audioRef?: string;
  uploadStatus: 'local' | 'uploading' | 'uploaded' | 'failed';
  transcriptionStatus: 'not_requested' | 'queued' | 'processing' | 'completed' | 'failed';
  transcript?: string;
};

export type MaterialUsageLine = {
  id: string;
  workOrderId: string;
  itemId?: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  classification: 'consumable' | 'measured_consumable' | 'sellable_part' | 'serialized_part' | 'other';
  inventoryEffect: 'pending' | 'reserved' | 'consumed' | 'returned';
};

export type AddOnStatus = 'proposed' | 'accepted' | 'installed' | 'declined';

export type AddOnLine = {
  id: string;
  workOrderId: string;
  type: 'armaflex' | 'bracket' | 'switch_220v' | 'refrigerant' | 'drain_pump' | 'other';
  label: string;
  quantity: number;
  unitPriceAfl?: number;
  status: AddOnStatus;
  assetId?: string;
};

export type TechnicianReportDraft = {
  workOrderId: string;
  status: FieldReportStatus;
  originalText: string;
  voiceNoteIds: string[];
  transcript?: string;
  professionalDraft?: string;
  submittedAt?: string;
  submittedBy?: string;
};

export type ReportLanguage = 'es' | 'pap_aw' | 'en';

export type ReportOutput = {
  language: ReportLanguage;
  label: string;
  status: 'pending' | 'ready' | 'reviewed';
  text?: string;
};

export type OfficeReviewRecord = {
  workOrderId: string;
  status: 'waiting' | 'editing' | 'approved' | 'delivered';
  originalReport: string;
  professionalReport: string;
  outputs: ReportOutput[];
  reviewedBy?: string;
  reviewedAt?: string;
  deliveredAt?: string;
  deliveryChannel?: 'whatsapp' | 'email' | 'manual';
};

export type FieldAssignment = {
  id: string;
  workOrderId: string;
  vanId: string;
  teamLabel: string;
  technicianNames: string[];
  isPrimary: boolean;
  customerCommunicationOwner: boolean;
  supportForAssignmentId?: string;
};

export type WorkOrderAsset = {
  id: string;
  siteId: string;
  room: string;
  systemType: string;
  brand: string;
  capacity: string;
  serialNumber?: string;
  qrCode?: string;
  lastServiceAt?: string;
  nameplateRegistered: boolean;
};

export type WorkOrderRecord = {
  id: string;
  customerId: string;
  customerName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  workType: string;
  customerFacingDescription: string;
  technicianInstructions?: string;
  appointmentId?: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  lifecycle: WorkOrderLifecycleStatus;
  readiness: 'ready' | 'at_risk' | 'blocked' | 'not_checked';
  assetIds: string[];
  assignmentIds: string[];
  reportStatus: FieldReportStatus;
  priority: 'normal' | 'high' | 'urgent';
};

export const voiceNoteMaxSeconds = 120;

export function validateVoiceNoteDuration(durationSeconds: number) {
  if (durationSeconds <= 0) return { valid: false, message: 'Voice note duration must be greater than zero.' };
  if (durationSeconds > voiceNoteMaxSeconds) return { valid: false, message: 'Voice notes are limited to 2 minutes.' };
  return { valid: true, message: 'Voice note duration is valid.' };
}

export function shouldRequestNameplateEvidence(asset: Pick<WorkOrderAsset, 'nameplateRegistered'>, reason?: 'missing' | 'changed' | 'correction') {
  return !asset.nameplateRegistered || reason === 'missing' || reason === 'changed' || reason === 'correction';
}

export function canSubmitFieldReport(args: {
  interventions: EquipmentIntervention[];
  selectedAssetIds: string[];
  reportText: string;
  addOnsReviewed: boolean;
}) {
  const interventionAssetIds = new Set(args.interventions.map((item) => item.assetId));
  const missingAssets = args.selectedAssetIds.filter((assetId) => !interventionAssetIds.has(assetId));
  const blockers: string[] = [];
  if (missingAssets.length) blockers.push(`${missingAssets.length} selected equipment record(s) still need an intervention result.`);
  if (!args.reportText.trim()) blockers.push('Technician work summary is required.');
  if (!args.addOnsReviewed) blockers.push('Materials and add-ons must be reviewed before submission.');
  return { allowed: blockers.length === 0, blockers };
}

export function nextLifecycleStatus(status: WorkOrderLifecycleStatus): WorkOrderLifecycleStatus {
  const order: WorkOrderLifecycleStatus[] = ['draft', 'scheduled', 'en_route', 'on_site', 'working', 'technician_complete', 'office_review', 'closed'];
  const index = order.indexOf(status);
  if (index < 0 || index === order.length - 1) return status;
  return order[index + 1];
}

export function createDefaultReportOutputs(): ReportOutput[] {
  return [
    { language: 'es', label: 'Spanish', status: 'ready' },
    { language: 'pap_aw', label: 'Papiamento Aruba', status: 'pending' },
    { language: 'en', label: 'English', status: 'pending' },
  ];
}

// Work-order rules intentionally keep appointment scheduling, field execution,
// office review and customer delivery as distinct states. Completing technician
// work does not automatically close the work order or send a customer report.
