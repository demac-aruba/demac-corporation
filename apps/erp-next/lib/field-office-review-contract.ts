import {
  FIELD_AUTHORITY_API_VERSION,
  fieldVisitStateValid,
  type FieldVisitState,
} from './field-authority-contract';
import {
  type FieldDispositionPlannedWorkProgress,
} from './field-planned-work-disposition-contract';
import {
  parseFieldSaleJobResponse,
  type FieldSaleJobDetail,
  type FieldSaleLineStatus,
} from './field-sale-contract';
import type {
  FieldProfessionalReportInterventionReport,
  FieldProfessionalReportPreview,
} from './field-professional-report-contract';

const REVIEW_STATUSES = new Set(['pending', 'returned', 'approved'] as const);
const SUBMISSION_STATUSES = new Set(['ready', 'blocked', 'pending', 'returned', 'approved'] as const);
const PREVIEW_STATUSES = new Set(['in_progress', 'incomplete_report', 'partial', 'field_complete'] as const);
const SALE_LINE_STATUSES = new Set(['proposed', 'customer_approved', 'installed', 'delivered', 'sold', 'declined', 'voided'] as const);
const REPORT_SECTION_TYPES = new Set(['checklist', 'measurement_table', 'findings', 'photos', 'free_text', 'voice_note', 'customer_acknowledgement']);
const REPORT_SECTION_STATUSES = new Set(['pending', 'in_progress', 'completed']);
const NON_COVERING_INTERVENTION_STATUSES = new Set(['cancelled', 'declined', 'not_performed']);
const TERMINAL_INTERVENTION_STATUSES = new Set(['completed', 'not_performed', 'declined', 'cancelled']);
const INVENTORY_HANDOFF_STATUSES = new Set(['ready_for_inventory_authority', 'needs_inventory_review'] as const);
const BILLING_CANDIDATE_STATUSES = new Set(['ready_for_billing_review', 'needs_pricing_review'] as const);

export type FieldOfficeReviewStatus = 'pending' | 'returned' | 'approved';
export type FieldOfficeReviewDecision = 'approve' | 'return';
export type FieldOfficeReviewSubmissionStatus = 'ready' | 'blocked' | FieldOfficeReviewStatus;

export type FieldOfficeReviewBlocker = {
  code: string;
  message: string;
  entityId?: string;
};

export type FieldOfficeReviewSubmission = {
  allowed: boolean;
  status: FieldOfficeReviewSubmissionStatus;
  reviewId?: string;
  revisionNumber?: number;
  correctionRequired: boolean;
  reviewerNote?: string;
  blockers: FieldOfficeReviewBlocker[];
};

export type FieldInventoryHandoff = {
  id: string;
  officeReviewId: string;
  officeReviewRevisionId: string;
  revisionNumber: number;
  workOrderId: string;
  appointmentId: string;
  customerId: string;
  propertyId: string;
  visitId: string;
  sourceLocationId?: string;
  status: 'ready_for_inventory_authority' | 'needs_inventory_review';
  lines: Array<{
    sourceSaleLineId: string;
    itemKind: 'product';
    itemId: string;
    descriptionSnapshot: string;
    quantity: number;
    unit: string;
  }>;
  blockers: Array<{ code: string; message: string; sourceSaleLineId?: string }>;
  inventoryMovementIds: string[];
  sourceDecisionRequestId: string;
  createdAt: string;
  createdBy: string;
  version: 1;
};

export type FieldBillingCandidate = {
  id: string; officeReviewId: string; officeReviewRevisionId: string; revisionNumber: number;
  workOrderId: string; appointmentId: string; customerId: string; propertyId: string; visitId: string;
  status: 'ready_for_billing_review' | 'needs_pricing_review';
  lines: Array<{ sourceType: 'intervention' | 'sale_line'; sourceId: string; catalogItemId: string; description: string; quantity: number; unitPrice: number; currency: string; lineTotal: number }>;
  blockers: Array<{ code: string; message: string; sourceType?: 'intervention' | 'sale_line'; sourceId?: string }>;
  invoiceLineIds: string[]; sourceDecisionRequestId: string; createdAt: string; createdBy: string; version: 1;
};

export type FieldOfficeReviewVisitSnapshot = {
  id: string;
  previousVisitId?: string;
  status: string;
  version: number;
  requiresSecondVisit: boolean;
  secondVisitReason?: string;
};

export type FieldOfficeReviewSnapshot = {
  version: 1;
  source: 'canonical_field_truth';
  visitChain: FieldOfficeReviewVisitSnapshot[];
  plannedWorkProgress: FieldDispositionPlannedWorkProgress[];
  professionalReportPreview: FieldProfessionalReportPreview;
  visitAssets: Array<{
    id: string;
    visitId: string;
    assetId: string;
    sequence: number;
    locationLabel: string;
    source: string;
    status: string;
    addedOnSite: boolean;
    version: number;
  }>;
  interventions: Array<{
    id: string;
    visitId: string;
    visitAssetId: string;
    assetId: string;
    plannedWorkLineId?: string;
    serviceCatalogItemId: string;
    interventionType: string;
    priceSnapshot?: unknown;
    origin: string;
    status: string;
    resultCode?: string;
    resultNotes?: string;
    version: number;
  }>;
  plannedWorkDispositions: Array<{
    id: string;
    visitId: string;
    plannedWorkLineId: string;
    quantity: number;
    reasonCode: string;
    note?: string;
    version: 1;
  }>;
  scopeChanges: Array<{
    id: string;
    visitId: string;
    visitAssetId: string;
    interventionId: string;
    plannedWorkLineId?: string;
    origin: string;
    reason: string;
    requestedAt: string;
    resolvedAt?: string;
    version: number;
  }>;
  approvals: Array<{
    id: string;
    visitId: string;
    status: string;
    method: string;
    affected: Array<{ type: string; id: string }>;
    receiverName: string;
    decidedAt?: string;
    signatureEvidenceId?: string;
    note?: string;
    version: number;
  }>;
  fieldSaleLines: Array<{
    id: string;
    visitId: string;
    interventionId?: string;
    assetId?: string;
    catalogItemId?: string;
    descriptionSnapshot: string;
    quantity: number;
    unit: string;
    priceSnapshot?: unknown;
    status: FieldSaleLineStatus;
    soldByStaffId: string;
    requiresCustomerApproval: boolean;
    customerApprovalId?: string;
    nonCatalog: boolean;
    officeReviewRequired: boolean;
    notes?: string;
    version: number;
  }>;
  reports: FieldProfessionalReportInterventionReport[];
  visitAssetCount: number;
  distinctAssetCount: number;
};

export type FieldOfficeReviewRevision = {
  id: string;
  reviewId: string;
  revisionNumber: number;
  workOrderId: string;
  appointmentId: string;
  customerId: string;
  propertyId: string;
  visitId: string;
  sourceVisitVersion: number;
  submittedAt: string;
  submittedBy: string;
  requestId: string;
  correctionOfRevisionId?: string;
  officeReturnNote?: string;
  technicianCorrectionNote?: string;
  snapshot: FieldOfficeReviewSnapshot;
  version: 1;
};

export type FieldOfficeReview = {
  id: string;
  workOrderId: string;
  appointmentId: string;
  customerId: string;
  propertyId: string;
  visitId: string;
  status: FieldOfficeReviewStatus;
  currentRevisionId: string;
  currentRevisionNumber: number;
  submittedAt: string;
  submittedBy: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewerName?: string;
  reviewerNote?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  version: number;
};

export type FieldOfficeReviewQueueItem = FieldOfficeReview & {
  currentRevision: FieldOfficeReviewRevision;
};

export type FieldOfficeReviewJobDetail = FieldSaleJobDetail & {
  officeReviewSubmission: FieldOfficeReviewSubmission | null;
};

export type FieldSubmitOfficeReviewResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  review: FieldOfficeReview;
  revision: FieldOfficeReviewRevision;
  visit: FieldVisitState;
};

export type FieldDecideOfficeReviewResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  review: FieldOfficeReview;
  visit: FieldVisitState;
  inventoryHandoff: FieldInventoryHandoff | null;
  billingCandidate: FieldBillingCandidate | null;
};

export type FieldOfficeReviewQueueResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  reviews: FieldOfficeReviewQueueItem[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function optionalString(value: unknown) { return value === undefined || typeof value === 'string'; }
function timestamp(value: unknown) { return string(value) && Number.isFinite(Date.parse(value)); }
function positiveInteger(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1; }
function nonNegativeInteger(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function money(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.round(value * 100) === value * 100; }

function salePriceSnapshotValid(value: unknown, catalogItemId: unknown, quantity: unknown) {
  const price = record(value);
  return Boolean(price && string(price.currency) && money(price.unitPrice) && money(price.lineTotal)
    && price.lineTotal === Math.round((price.unitPrice as number) * (quantity as number) * 100) / 100
    && price.sourceCatalogItemId === catalogItemId && (string(price.pricingVersion) || positiveInteger(price.pricingVersion))
    && timestamp(price.capturedAt) && (price.discountAmount === undefined || money(price.discountAmount))
    && (price.taxAmount === undefined || money(price.taxAmount)));
}

function blockerValid(value: unknown): value is FieldOfficeReviewBlocker {
  const item = record(value);
  return Boolean(item && string(item.code) && string(item.message) && optionalString(item.entityId));
}

function inventoryHandoffValid(value: unknown, review: FieldOfficeReview) {
  if (value === null) return true;
  const item = record(value);
  if (!item || !string(item.status) || !INVENTORY_HANDOFF_STATUSES.has(item.status as FieldInventoryHandoff['status'])
    || !string(item.id) || item.officeReviewId !== review.id || item.officeReviewRevisionId !== review.currentRevisionId
    || item.revisionNumber !== review.currentRevisionNumber || item.workOrderId !== review.workOrderId
    || item.appointmentId !== review.appointmentId || item.customerId !== review.customerId
    || item.propertyId !== review.propertyId || item.visitId !== review.visitId
    || !optionalString(item.sourceLocationId) || !string(item.sourceDecisionRequestId)
    || !timestamp(item.createdAt) || !string(item.createdBy) || item.version !== 1
    || !Array.isArray(item.lines) || !item.lines.length || !Array.isArray(item.blockers)
    || !Array.isArray(item.inventoryMovementIds) || item.inventoryMovementIds.length) return false;
  const sourceIds = new Set<string>();
  const linesValid = item.lines.every((candidate) => {
    const line = record(candidate);
    if (!line || !string(line.sourceSaleLineId) || sourceIds.has(line.sourceSaleLineId)
      || line.itemKind !== 'product' || !string(line.itemId) || !string(line.descriptionSnapshot)
      || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0
      || Math.round(line.quantity * 1000) !== line.quantity * 1000 || !string(line.unit)) return false;
    sourceIds.add(line.sourceSaleLineId);
    return true;
  });
  const blockersValid = item.blockers.every((candidate) => {
    const blocker = record(candidate);
    return Boolean(blocker && string(blocker.code) && string(blocker.message) && optionalString(blocker.sourceSaleLineId));
  });
  const ready = item.status === 'ready_for_inventory_authority';
  return linesValid && blockersValid
    && ((ready && string(item.sourceLocationId) && item.blockers.length === 0)
      || (!ready && item.blockers.length > 0));
}

function billingCandidateValid(value: unknown, review: FieldOfficeReview) {
  if (value === null) return true;
  const item = record(value);
  if (!item || !string(item.status) || !BILLING_CANDIDATE_STATUSES.has(item.status as FieldBillingCandidate['status'])
    || !string(item.id) || item.officeReviewId !== review.id || item.officeReviewRevisionId !== review.currentRevisionId
    || item.revisionNumber !== review.currentRevisionNumber || item.workOrderId !== review.workOrderId
    || item.appointmentId !== review.appointmentId || item.customerId !== review.customerId || item.propertyId !== review.propertyId
    || item.visitId !== review.visitId || !Array.isArray(item.lines) || !Array.isArray(item.blockers)
    || !Array.isArray(item.invoiceLineIds) || item.invoiceLineIds.length || !string(item.sourceDecisionRequestId)
    || !timestamp(item.createdAt) || !string(item.createdBy) || item.version !== 1 || (!item.lines.length && !item.blockers.length)) return false;
  const sourceKeys = new Set<string>();
  const linesValid = item.lines.every((candidate) => {
    const line = record(candidate); const key = `${line?.sourceType}:${line?.sourceId}`;
    if (!line || !['intervention', 'sale_line'].includes(String(line.sourceType)) || !string(line.sourceId) || sourceKeys.has(key)
      || !string(line.catalogItemId) || !string(line.description) || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity)
      || line.quantity <= 0 || !money(line.unitPrice) || !string(line.currency) || !money(line.lineTotal)
      || Math.abs(Number(line.lineTotal) - Number((Number(line.quantity) * Number(line.unitPrice)).toFixed(2))) > 0.001) return false;
    sourceKeys.add(key); return true;
  });
  const blockersValid = item.blockers.every((candidate) => { const blocker = record(candidate); return Boolean(blocker && string(blocker.code) && string(blocker.message) && optionalString(blocker.sourceType) && optionalString(blocker.sourceId) && (!blocker.sourceType || ['intervention', 'sale_line'].includes(String(blocker.sourceType)))); });
  const ready = item.status === 'ready_for_billing_review';
  const currencies = new Set(item.lines.map((candidate) => record(candidate)?.currency));
  return linesValid && blockersValid && ((ready && item.lines.length > 0 && item.blockers.length === 0 && currencies.size === 1) || (!ready && item.blockers.length > 0));
}

function reviewValid(value: unknown): value is FieldOfficeReview {
  const item = record(value);
  if (!item || !string(item.status) || !REVIEW_STATUSES.has(item.status as FieldOfficeReviewStatus)) return false;
  const decided = item.status === 'returned' || item.status === 'approved';
  return string(item.id)
    && string(item.workOrderId)
    && string(item.appointmentId)
    && string(item.customerId)
    && string(item.propertyId)
    && string(item.visitId)
    && string(item.currentRevisionId)
    && positiveInteger(item.currentRevisionNumber)
    && timestamp(item.submittedAt)
    && string(item.submittedBy)
    && optionalString(item.reviewedAt)
    && optionalString(item.reviewedBy)
    && optionalString(item.reviewerName)
    && optionalString(item.reviewerNote)
    && (!decided || (timestamp(item.reviewedAt) && string(item.reviewedBy)))
    && timestamp(item.createdAt)
    && string(item.createdBy)
    && timestamp(item.updatedAt)
    && positiveInteger(item.version);
}

function completionValid(value: unknown, template: Record<string, unknown>, sectionStatus: Record<string, unknown>) {
  const item = record(value);
  const sections = Array.isArray(template.sections) ? template.sections.map(record) : [];
  const required = sections.filter((section) => section?.required === true);
  const incomplete = required.filter((section) => section && sectionStatus[section.id as string] !== 'completed');
  if (!item || !nonNegativeInteger(item.requiredSectionCount) || !nonNegativeInteger(item.completedRequiredSectionCount)
    || !Array.isArray(item.incompleteRequiredSections) || typeof item.complete !== 'boolean'
    || item.requiredSectionCount !== required.length
    || item.completedRequiredSectionCount !== required.length - incomplete.length
    || item.complete !== (incomplete.length === 0)
    || item.incompleteRequiredSections.length !== incomplete.length) return false;
  return incomplete.every((section, index) => {
    const blocker = record((item.incompleteRequiredSections as unknown[])[index]);
    return Boolean(blocker && section && blocker.id === section.id && blocker.title === section.title
      && blocker.type === section.type && blocker.status === sectionStatus[section.id as string]);
  });
}

function reportTemplateAndStatusValid(report: Record<string, unknown>) {
  const template = record(report.template);
  const status = record(report.sectionStatus);
  if (!template || !status || !string(template.id) || !string(template.name)
    || template.serviceId !== report.serviceCatalogItemId || !positiveInteger(template.version)
    || !Array.isArray(template.sections) || template.sections.length < 1 || template.sections.length > 50) return false;
  const sectionIds = new Set<string>();
  for (const candidate of template.sections) {
    const section = record(candidate);
    if (!section || !string(section.id) || sectionIds.has(section.id) || !string(section.title)
      || !string(section.type) || !REPORT_SECTION_TYPES.has(section.type) || typeof section.required !== 'boolean'
      || !(section.minEvidenceCount === undefined || nonNegativeInteger(section.minEvidenceCount))
      || !(section.minMeasurementCount === undefined || nonNegativeInteger(section.minMeasurementCount))) return false;
    if (section.type === 'checklist') {
      if (!Array.isArray(section.checklistItems) || !section.checklistItems.length
        || !section.checklistItems.every((item) => {
          const entry = record(item); return Boolean(entry && string(entry.id) && string(entry.label));
        }) || new Set(section.checklistItems.map((item) => record(item)?.id)).size !== section.checklistItems.length) return false;
    } else if (section.checklistItems !== undefined) return false;
    sectionIds.add(section.id);
  }
  if (Object.keys(status).length !== sectionIds.size
    || [...sectionIds].some((id) => !REPORT_SECTION_STATUSES.has(String(status[id])))) return false;
  return completionValid(report.completion, template, status);
}

function reportContentArraysValid(report: Record<string, unknown>) {
  const template = record(report.template) as Record<string, unknown>;
  const sections = new Map((template.sections as unknown[]).map((candidate) => {
    const section = record(candidate) as Record<string, unknown>;
    return [section.id as string, section];
  }));
  const base = (item: Record<string, unknown>, type: string) => {
    const section = sections.get(item.sectionId as string);
    return string(item.id) && item.visitAssetId === report.visitAssetId && item.assetId === report.assetId
      && item.interventionId === report.interventionId && string(item.visitId) && string(item.sectionId)
      && section?.type === type;
  };
  const evidenceValid = Array.isArray(report.evidence) && report.evidence.every((candidate) => {
    const item = record(candidate); return Boolean(item && base(item, 'photos') && item.kind === 'photo'
      && string(item.storagePath) && string(item.contentType) && positiveInteger(item.sizeBytes)
      && optionalString(item.caption) && timestamp(item.capturedAt) && timestamp(item.createdAt)
      && string(item.createdBy) && timestamp(item.updatedAt) && string(item.updatedBy) && positiveInteger(item.version));
  });
  const measurementsValid = Array.isArray(report.measurements) && report.measurements.every((candidate) => {
    const item = record(candidate); return Boolean(item && base(item, 'measurement_table') && string(item.metric)
      && ((typeof item.value === 'number' && Number.isFinite(item.value)) || string(item.value)) && string(item.unit)
      && string(item.moment) && string(item.technicianStaffId) && timestamp(item.measuredAt) && timestamp(item.createdAt)
      && string(item.createdBy) && timestamp(item.updatedAt) && string(item.updatedBy) && positiveInteger(item.version));
  });
  const findingsValid = Array.isArray(report.findings) && report.findings.every((candidate) => {
    const item = record(candidate); return Boolean(item && base(item, 'findings') && string(item.summary)
      && string(item.details) && optionalString(item.recommendation) && string(item.technicianStaffId)
      && timestamp(item.observedAt) && timestamp(item.createdAt) && string(item.createdBy)
      && timestamp(item.updatedAt) && string(item.updatedBy) && positiveInteger(item.version));
  });
  const checklistValid = Array.isArray(report.checklistResponses) && report.checklistResponses.every((candidate) => {
    const item = record(candidate); const section = item && sections.get(item.sectionId as string);
    return Boolean(item && base(item, 'checklist') && string(item.itemId) && typeof item.checked === 'boolean'
      && Array.isArray(section?.checklistItems) && (section?.checklistItems as unknown[]).some((entry) => record(entry)?.id === item.itemId)
      && string(item.technicianStaffId) && timestamp(item.respondedAt) && timestamp(item.createdAt)
      && string(item.createdBy) && timestamp(item.updatedAt) && string(item.updatedBy) && positiveInteger(item.version));
  });
  const freeTextValid = Array.isArray(report.freeTextResponses) && report.freeTextResponses.every((candidate) => {
    const item = record(candidate); return Boolean(item && base(item, 'free_text') && typeof item.value === 'string'
      && string(item.technicianStaffId) && timestamp(item.respondedAt) && timestamp(item.createdAt)
      && string(item.createdBy) && timestamp(item.updatedAt) && string(item.updatedBy) && positiveInteger(item.version));
  });
  const acknowledgementsValid = Array.isArray(report.customerAcknowledgements) && report.customerAcknowledgements.every((candidate) => {
    const item = record(candidate); return Boolean(item && base(item, 'customer_acknowledgement') && string(item.receiverName)
      && item.method === 'verbal' && optionalString(item.note) && timestamp(item.acknowledgedAt)
      && string(item.recordedByStaffId) && timestamp(item.createdAt) && string(item.createdBy) && item.version === 1);
  });
  const voiceValid = Array.isArray(report.voiceNotes) && report.voiceNotes.every((candidate) => {
    const item = record(candidate); return Boolean(item && base(item, 'voice_note') && item.kind === 'voice_note'
      && string(item.storagePath) && string(item.contentType) && positiveInteger(item.sizeBytes)
      && typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds) && item.durationSeconds > 0
      && timestamp(item.capturedAt) && timestamp(item.createdAt) && string(item.createdBy) && item.version === 1);
  });
  const arrays = [report.evidence, report.measurements, report.findings, report.checklistResponses,
    report.freeTextResponses, report.customerAcknowledgements, report.voiceNotes] as unknown[][];
  const ids = arrays.flatMap((entries) => entries.map((entry) => record(entry)?.id));
  const singletonKeys = [
    ...(report.freeTextResponses as unknown[]).map((entry) => `free_text:${record(entry)?.sectionId}`),
    ...(report.customerAcknowledgements as unknown[]).map((entry) => `customer_acknowledgement:${record(entry)?.sectionId}`),
    ...(report.voiceNotes as unknown[]).map((entry) => `voice_note:${record(entry)?.sectionId}`),
  ];
  const checklistKeys = (report.checklistResponses as unknown[])
    .map((entry) => `${record(entry)?.sectionId}:${record(entry)?.itemId}`);
  const contentStatusValid = [...sections.values()].every((section) => {
    let complete: boolean;
    if (section.type === 'checklist') {
      const responses = new Map((report.checklistResponses as unknown[])
        .filter((entry) => record(entry)?.sectionId === section.id)
        .map((entry) => [record(entry)?.itemId, record(entry)?.checked]));
      complete = (section.checklistItems as unknown[]).length > 0
        && (section.checklistItems as unknown[]).every((entry) => responses.get(record(entry)?.id) === true);
    } else if (section.type === 'free_text') {
      complete = (report.freeTextResponses as unknown[])
        .some((entry) => record(entry)?.sectionId === section.id && string(record(entry)?.value));
    } else if (section.type === 'customer_acknowledgement') {
      complete = (report.customerAcknowledgements as unknown[]).some((entry) => record(entry)?.sectionId === section.id);
    } else if (section.type === 'voice_note') {
      complete = (report.voiceNotes as unknown[]).some((entry) => record(entry)?.sectionId === section.id);
    } else return true;
    return complete === (record(report.sectionStatus)?.[section.id as string] === 'completed');
  });
  return evidenceValid && measurementsValid && findingsValid && checklistValid && freeTextValid
    && acknowledgementsValid && voiceValid && ids.every(string) && new Set(ids).size === ids.length
    && new Set(singletonKeys).size === singletonKeys.length && new Set(checklistKeys).size === checklistKeys.length
    && contentStatusValid;
}

function previewValid(value: unknown, revision: Record<string, unknown>) {
  const item = record(value);
  return Boolean(item
    && item.version === 1
    && item.source === 'canonical_field_truth'
    && item.visitId === revision.visitId
    && item.workOrderId === revision.workOrderId
    && item.customerId === revision.customerId
    && item.propertyId === revision.propertyId
    && string(item.status)
    && PREVIEW_STATUSES.has(item.status as FieldProfessionalReportPreview['status'])
    && nonNegativeInteger(item.plannedQuantity)
    && nonNegativeInteger(item.unreconciledPlannedQuantity)
    && nonNegativeInteger(item.actualAssetCount)
    && nonNegativeInteger(item.interventionCount)
    && nonNegativeInteger(item.completedInterventionCount)
    && nonNegativeInteger(item.pendingPartInterventionCount)
    && nonNegativeInteger(item.notPerformedInterventionCount)
    && nonNegativeInteger(item.activeInterventionCount)
    && nonNegativeInteger(item.requiredSectionCount)
    && nonNegativeInteger(item.completedRequiredSectionCount)
    && Array.isArray(item.incompleteRequiredSections));
}

function revisionValid(value: unknown, review?: FieldOfficeReview): value is FieldOfficeReviewRevision {
  const item = record(value);
  const snapshot = record(item?.snapshot);
  if (!item || !snapshot
    || !string(item.id)
    || !string(item.reviewId)
    || !positiveInteger(item.revisionNumber)
    || !string(item.workOrderId)
    || !string(item.appointmentId)
    || !string(item.customerId)
    || !string(item.propertyId)
    || !string(item.visitId)
    || !positiveInteger(item.sourceVisitVersion)
    || !timestamp(item.submittedAt)
    || !string(item.submittedBy)
    || !string(item.requestId)
    || !optionalString(item.correctionOfRevisionId)
    || !optionalString(item.officeReturnNote)
    || !optionalString(item.technicianCorrectionNote)
    || item.version !== 1
    || snapshot.version !== 1
    || snapshot.source !== 'canonical_field_truth'
    || !Array.isArray(snapshot.visitChain)
    || snapshot.visitChain.length < 1
    || !Array.isArray(snapshot.plannedWorkProgress)
    || !Array.isArray(snapshot.visitAssets)
    || !Array.isArray(snapshot.interventions)
    || !Array.isArray(snapshot.plannedWorkDispositions)
    || !Array.isArray(snapshot.scopeChanges)
    || !Array.isArray(snapshot.approvals)
    || !Array.isArray(snapshot.fieldSaleLines)
    || !Array.isArray(snapshot.reports)
    || !nonNegativeInteger(snapshot.visitAssetCount)
    || !nonNegativeInteger(snapshot.distinctAssetCount)
    || !previewValid(snapshot.professionalReportPreview, item)) return false;
  const correctionFields = [item.correctionOfRevisionId, item.officeReturnNote, item.technicianCorrectionNote];
  if (item.revisionNumber === 1 && correctionFields.some((field) => field !== undefined)) return false;
  if ((item.revisionNumber as number) > 1 && !correctionFields.every(string)) return false;
  if (review && (item.reviewId !== review.id
    || item.id !== review.currentRevisionId
    || item.revisionNumber !== review.currentRevisionNumber
    || item.workOrderId !== review.workOrderId
    || item.appointmentId !== review.appointmentId
    || item.customerId !== review.customerId
    || item.propertyId !== review.propertyId
    || item.visitId !== review.visitId)) return false;
  const visitsValid = snapshot.visitChain.every((candidate) => {
    const visit = record(candidate);
    return Boolean(visit && string(visit.id) && optionalString(visit.previousVisitId) && string(visit.status)
      && positiveInteger(visit.version) && typeof visit.requiresSecondVisit === 'boolean' && optionalString(visit.secondVisitReason));
  });
  const visits = snapshot.visitChain as Array<Record<string, unknown>>;
  const linearVisits = visits.every((visit, index) => (
    (index === 0 ? visit.previousVisitId === undefined : visit.previousVisitId === visits[index - 1].id)
  )) && visits.at(-1)?.id === item.visitId && visits.at(-1)?.version === item.sourceVisitVersion;
  const plannedWorkValid = snapshot.plannedWorkProgress.every((candidate) => {
    const progress = record(candidate);
    return Boolean(progress && string(progress.id)
      && nonNegativeInteger(progress.plannedQuantity)
      && nonNegativeInteger(progress.linkedActualQuantity)
      && nonNegativeInteger(progress.disposedQuantity)
      && nonNegativeInteger(progress.remainingQuantity)
      && (progress.linkedActualQuantity as number) + (progress.disposedQuantity as number) + (progress.remainingQuantity as number)
        === progress.plannedQuantity);
  });
  const interventionsValid = snapshot.interventions.every((candidate) => {
    const intervention = record(candidate);
    return Boolean(intervention && string(intervention.id) && string(intervention.visitId) && string(intervention.visitAssetId)
      && string(intervention.assetId) && optionalString(intervention.plannedWorkLineId) && string(intervention.serviceCatalogItemId)
      && typeof intervention.interventionType === 'string' && string(intervention.origin) && string(intervention.status)
      && (intervention.priceSnapshot === undefined || salePriceSnapshotValid(intervention.priceSnapshot, intervention.serviceCatalogItemId, 1))
      && optionalString(intervention.resultCode) && optionalString(intervention.resultNotes) && positiveInteger(intervention.version));
  });
  const visitAssetsValid = snapshot.visitAssets.every((candidate) => {
    const asset = record(candidate);
    return Boolean(asset && string(asset.id) && string(asset.visitId) && string(asset.assetId)
      && positiveInteger(asset.sequence) && typeof asset.locationLabel === 'string' && string(asset.source)
      && string(asset.status) && typeof asset.addedOnSite === 'boolean' && positiveInteger(asset.version));
  });
  const dispositionsValid = snapshot.plannedWorkDispositions.every((candidate) => {
    const disposition = record(candidate);
    return Boolean(disposition && string(disposition.id) && string(disposition.visitId)
      && string(disposition.plannedWorkLineId) && positiveInteger(disposition.quantity)
      && string(disposition.reasonCode) && optionalString(disposition.note) && disposition.version === 1);
  });
  const scopeChangesValid = snapshot.scopeChanges.every((candidate) => {
    const change = record(candidate);
    return Boolean(change && string(change.id) && string(change.visitId) && string(change.visitAssetId)
      && string(change.interventionId) && optionalString(change.plannedWorkLineId) && string(change.origin)
      && string(change.reason) && timestamp(change.requestedAt) && optionalString(change.resolvedAt)
      && (!change.resolvedAt || timestamp(change.resolvedAt)) && positiveInteger(change.version));
  });
  const approvalsValid = snapshot.approvals.every((candidate) => {
    const approval = record(candidate);
    return Boolean(approval && string(approval.id) && string(approval.visitId) && string(approval.status)
      && string(approval.method) && Array.isArray(approval.affected) && approval.affected.length > 0
      && approval.affected.every((reference) => {
        const affected = record(reference);
        return Boolean(affected && string(affected.type) && string(affected.id));
      })
      && (approval.affected.every((reference) => record(reference)?.type !== 'sale_line') || approval.affected.length === 1)
      && string(approval.receiverName) && optionalString(approval.decidedAt)
      && (!approval.decidedAt || timestamp(approval.decidedAt)) && optionalString(approval.signatureEvidenceId)
      && optionalString(approval.note) && positiveInteger(approval.version));
  });
  const saleLinesValid = snapshot.fieldSaleLines.every((candidate) => {
    const line = record(candidate);
    return Boolean(line && string(line.id) && string(line.visitId) && optionalString(line.interventionId)
      && optionalString(line.assetId) && optionalString(line.catalogItemId) && string(line.descriptionSnapshot)
      && typeof line.quantity === 'number' && Number.isFinite(line.quantity) && line.quantity > 0
      && string(line.unit) && string(line.status) && SALE_LINE_STATUSES.has(line.status as FieldSaleLineStatus)
      && string(line.soldByStaffId) && typeof line.requiresCustomerApproval === 'boolean' && optionalString(line.customerApprovalId)
      && typeof line.nonCatalog === 'boolean' && typeof line.officeReviewRequired === 'boolean'
      && optionalString(line.notes) && positiveInteger(line.version)
      && (line.nonCatalog ? line.catalogItemId === undefined && line.priceSnapshot === undefined
          && line.officeReviewRequired === true && line.requiresCustomerApproval === false
          && ['proposed', 'voided'].includes(line.status as string)
        : string(line.catalogItemId) && salePriceSnapshotValid(line.priceSnapshot, line.catalogItemId, line.quantity)
          && line.officeReviewRequired === false && line.requiresCustomerApproval === true)
      && (!['customer_approved', 'installed', 'delivered', 'sold', 'declined'].includes(line.status as string)
        || string(line.customerApprovalId)));
  });
  const reportsValid = snapshot.reports.every((candidate) => {
    const report = record(candidate);
    return Boolean(report && string(report.interventionId) && string(report.visitAssetId) && string(report.assetId)
      && string(report.serviceCatalogItemId) && reportTemplateAndStatusValid(report) && reportContentArraysValid(report));
  });
  const interventionIds = new Set(snapshot.interventions.map((candidate) => record(candidate)?.id));
  const visitAssetIds = new Set(snapshot.visitAssets.map((candidate) => record(candidate)?.id));
  const plannedWorkLineIds = new Set(snapshot.plannedWorkProgress.map((candidate) => record(candidate)?.id));
  const scopeChangeIds = new Set(snapshot.scopeChanges.map((candidate) => record(candidate)?.id));
  const saleLineIds = new Set(snapshot.fieldSaleLines.map((candidate) => record(candidate)?.id));
  const canonicalAssetIds = new Set(snapshot.visitAssets.map((candidate) => record(candidate)?.assetId));
  const visitIds = new Set(visits.map((candidate) => candidate.id));
  const interventionById = new Map(snapshot.interventions.map((candidate) => {
    const intervention = record(candidate) as Record<string, unknown>;
    return [intervention.id, intervention];
  }));
  const visitIndex = new Map(visits.map((visit, index) => [visit.id, index]));
  const effectiveInterventions = (snapshot.interventions as unknown[]).map(record).filter((intervention) => {
    if (!intervention || intervention.status !== 'pending_part' || !string(intervention.plannedWorkLineId)) return Boolean(intervention);
    const index = visitIndex.get(intervention.visitId) ?? -1;
    return !(snapshot.interventions as unknown[]).map(record).some((candidate) => candidate
      && (visitIndex.get(candidate.visitId) ?? -1) > index
      && candidate.plannedWorkLineId === intervention.plannedWorkLineId
      && candidate.assetId === intervention.assetId
      && !NON_COVERING_INTERVENTION_STATUSES.has(String(candidate.status)));
  }) as Array<Record<string, unknown>>;
  const effectiveIds = new Set(effectiveInterventions.map((intervention) => intervention.id));
  const effectiveReports = (snapshot.reports as unknown[]).map(record)
    .filter((report) => report && effectiveIds.has(report.interventionId)) as Array<Record<string, unknown>>;
  const effectiveReportByInterventionId = new Map(effectiveReports.map((report) => [report.interventionId, report]));
  const expectedMissingSections = effectiveInterventions.flatMap((intervention) => {
    const completion = record(effectiveReportByInterventionId.get(intervention.id)?.completion);
    return Array.isArray(completion?.incompleteRequiredSections)
      ? completion.incompleteRequiredSections.map((candidate) => {
        const section = record(candidate);
        return {
          interventionId: intervention.id,
          id: section?.id,
          title: section?.title,
          type: section?.type,
          status: section?.status,
        };
      })
      : [];
  });
  const preview = snapshot.professionalReportPreview as Record<string, unknown>;
  const expectedUnreconciled = (snapshot.plannedWorkProgress as unknown[])
    .reduce<number>((total, candidate) => total + Number(record(candidate)?.remainingQuantity), 0);
  const expectedRequired = effectiveReports.reduce((total, report) => total + Number(record(report.completion)?.requiredSectionCount), 0);
  const expectedCompletedRequired = effectiveReports
    .reduce((total, report) => total + Number(record(report.completion)?.completedRequiredSectionCount), 0);
  const expectedPreviewStatus = effectiveInterventions.some((intervention) => intervention.status === 'pending_part')
    ? 'partial'
    : expectedMissingSections.length > 0
      ? 'incomplete_report'
      : expectedUnreconciled > 0
        ? 'in_progress'
        : effectiveInterventions.length > 0
          && effectiveInterventions.every((intervention) => TERMINAL_INTERVENTION_STATUSES.has(String(intervention.status)))
          ? 'field_complete'
          : 'in_progress';
  const previewRelationsValid = preview.status === expectedPreviewStatus
    && preview.plannedQuantity === (snapshot.plannedWorkProgress as unknown[])
      .reduce<number>((total, candidate) => total + Number(record(candidate)?.plannedQuantity), 0)
    && preview.unreconciledPlannedQuantity === expectedUnreconciled
    && preview.interventionCount === effectiveInterventions.length
    && preview.completedInterventionCount === effectiveInterventions.filter((entry) => entry.status === 'completed').length
    && preview.pendingPartInterventionCount === effectiveInterventions.filter((entry) => entry.status === 'pending_part').length
    && preview.notPerformedInterventionCount === effectiveInterventions.filter((entry) => entry.status === 'not_performed').length
    && preview.activeInterventionCount === effectiveInterventions
      .filter((entry) => ['planned', 'confirmed', 'in_progress', 'pending_authorization'].includes(String(entry.status))).length
    && preview.requiredSectionCount === expectedRequired
    && preview.completedRequiredSectionCount === expectedCompletedRequired
    && (preview.incompleteRequiredSections as unknown[]).length === expectedMissingSections.length
    && expectedMissingSections.every((expected, index) => {
      const actual = record((preview.incompleteRequiredSections as unknown[])[index]);
      return Boolean(actual && actual.interventionId === expected.interventionId && actual.sectionId === expected.id
        && actual.title === expected.title && actual.type === expected.type && actual.status === expected.status);
    });
  const saleApprovalByLine = new Map<string, Record<string, unknown>>();
  let saleApprovalsValid = true;
  for (const candidate of snapshot.approvals) {
    const approval = record(candidate);
    const references = (approval?.affected as unknown[]).map(record).filter((reference) => reference?.type === 'sale_line');
    if (!references.length) continue;
    const lineId = references[0]?.id;
    if (references.length !== 1 || (approval?.affected as unknown[]).length !== 1 || !string(lineId) || saleApprovalByLine.has(lineId)) {
      saleApprovalsValid = false;
      continue;
    }
    saleApprovalByLine.set(lineId, approval as Record<string, unknown>);
  }
  const saleDecisionRelationsValid = snapshot.fieldSaleLines.every((candidate) => {
    const line = record(candidate) as Record<string, unknown>;
    const approval = saleApprovalByLine.get(line.id as string);
    if (line.status === 'proposed') return !approval && line.customerApprovalId === undefined;
    if (line.status === 'declined') return approval?.status === 'rejected' && approval.id === line.customerApprovalId;
    if (['customer_approved', 'installed', 'delivered', 'sold'].includes(line.status as string)) {
      return approval?.status === 'approved' && approval.id === line.customerApprovalId;
    }
    return line.status === 'voided' && Boolean(approval) === Boolean(line.customerApprovalId)
      && (!approval || approval.id === line.customerApprovalId);
  });
  const relationsValid = snapshot.visitAssets.every((candidate) => visitIds.has(record(candidate)?.visitId))
    && snapshot.interventions.every((candidate) => visitIds.has(record(candidate)?.visitId)
      && visitAssetIds.has(record(candidate)?.visitAssetId))
    && snapshot.plannedWorkDispositions.every((candidate) => visitIds.has(record(candidate)?.visitId)
      && plannedWorkLineIds.has(record(candidate)?.plannedWorkLineId))
    && snapshot.scopeChanges.every((candidate) => visitIds.has(record(candidate)?.visitId)
      && visitAssetIds.has(record(candidate)?.visitAssetId)
      && interventionIds.has(record(candidate)?.interventionId))
    && snapshot.approvals.every((candidate) => visitIds.has(record(candidate)?.visitId)
      && (record(candidate)?.affected as unknown[]).every((reference) => {
        const affected = record(reference);
        return affected?.type === 'intervention'
          ? interventionIds.has(affected.id)
          : affected?.type === 'scope_change'
            ? scopeChangeIds.has(affected.id)
            : affected?.type === 'sale_line' && saleLineIds.has(affected.id);
      }))
    && snapshot.fieldSaleLines.every((candidate) => visitIds.has(record(candidate)?.visitId)
      && (!record(candidate)?.interventionId || interventionIds.has(record(candidate)?.interventionId))
      && (!record(candidate)?.assetId || canonicalAssetIds.has(record(candidate)?.assetId)))
    && new Set(snapshot.reports.map((candidate) => record(candidate)?.interventionId)).size === snapshot.reports.length
    && snapshot.reports.every((candidate) => {
      const report = record(candidate) as Record<string, unknown>;
      const intervention = interventionById.get(report.interventionId);
      const content = [report.evidence, report.measurements, report.findings, report.checklistResponses,
        report.freeTextResponses, report.customerAcknowledgements, report.voiceNotes] as unknown[][];
      return Boolean(intervention && report.visitAssetId === intervention.visitAssetId
        && report.assetId === intervention.assetId && report.serviceCatalogItemId === intervention.serviceCatalogItemId
        && content.flat().every((entry) => record(entry)?.visitId === intervention.visitId));
    })
    && snapshot.visitAssetCount === snapshot.visitAssets.length
    && snapshot.distinctAssetCount === new Set(snapshot.visitAssets.map((candidate) => record(candidate)?.assetId)).size
    && (snapshot.professionalReportPreview as Record<string, unknown>).actualAssetCount === snapshot.distinctAssetCount
    && saleApprovalsValid && saleDecisionRelationsValid && previewRelationsValid;
  return visitsValid && linearVisits && plannedWorkValid && visitAssetsValid && interventionsValid
    && dispositionsValid && scopeChangesValid && approvalsValid && saleLinesValid && reportsValid && relationsValid;
}

function submissionValid(value: unknown): value is FieldOfficeReviewSubmission | null {
  if (value === null) return true;
  const item = record(value);
  if (!item || typeof item.allowed !== 'boolean' || !string(item.status)
    || !SUBMISSION_STATUSES.has(item.status as FieldOfficeReviewSubmissionStatus)
    || !optionalString(item.reviewId)
    || !(item.revisionNumber === undefined || positiveInteger(item.revisionNumber))
    || typeof item.correctionRequired !== 'boolean'
    || !optionalString(item.reviewerNote)
    || !Array.isArray(item.blockers)
    || !item.blockers.every(blockerValid)) return false;
  if (item.correctionRequired && (!string(item.reviewId) || !positiveInteger(item.revisionNumber) || !string(item.reviewerNote))) return false;
  return item.allowed === (item.status === 'ready' && item.blockers.length === 0);
}

function envelope(value: unknown) {
  const payload = record(value);
  if (!payload || payload.success !== true || payload.version !== FIELD_AUTHORITY_API_VERSION) {
    throw new Error('Field Operations returned malformed Office Review data. Refresh and try again.');
  }
  return payload;
}

export function parseFieldOfficeReviewJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldOfficeReviewJobDetail;
} {
  const base = parseFieldSaleJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  if (!rawJob || !Object.prototype.hasOwnProperty.call(rawJob, 'officeReviewSubmission')
    || !submissionValid(rawJob.officeReviewSubmission)) {
    throw new Error('Field Operations returned inconsistent Office Review readiness. Refresh and try again.');
  }
  return {
    success: true,
    version: FIELD_AUTHORITY_API_VERSION,
    job: { ...base.job, officeReviewSubmission: rawJob.officeReviewSubmission as FieldOfficeReviewSubmission | null },
  };
}

export function parseFieldOfficeReviewQueueResponse(value: unknown): FieldOfficeReviewQueueResponse {
  const payload = envelope(value);
  if (!Array.isArray(payload.reviews) || !payload.reviews.every((candidate) => {
    if (!reviewValid(candidate)) return false;
    const review = candidate as FieldOfficeReviewQueueItem;
    return revisionValid(review.currentRevision, review);
  })) throw new Error('Field Operations returned malformed Office Review queue data. Refresh and try again.');
  return payload as FieldOfficeReviewQueueResponse;
}

export function parseFieldSubmitOfficeReviewResponse(value: unknown): FieldSubmitOfficeReviewResponse {
  const payload = envelope(value);
  if (typeof payload.replayed !== 'boolean' || !reviewValid(payload.review)
    || !revisionValid(payload.revision, payload.review as FieldOfficeReview)
    || !fieldVisitStateValid(payload.visit)
    || (payload.visit as FieldVisitState).id !== (payload.review as FieldOfficeReview).visitId
    || (payload.visit as FieldVisitState).status !== 'ready_for_office_review') {
    throw new Error('Field Operations returned malformed Office Review submission data. Refresh and try again.');
  }
  return payload as FieldSubmitOfficeReviewResponse;
}

export function parseFieldDecideOfficeReviewResponse(value: unknown): FieldDecideOfficeReviewResponse {
  const payload = envelope(value);
  if (typeof payload.replayed !== 'boolean' || !reviewValid(payload.review) || !fieldVisitStateValid(payload.visit)
    || !Object.prototype.hasOwnProperty.call(payload, 'inventoryHandoff')
    || !Object.prototype.hasOwnProperty.call(payload, 'billingCandidate')) {
    throw new Error('Field Operations returned malformed Office Review decision data. Refresh and try again.');
  }
  const review = payload.review as FieldOfficeReview;
  const visit = payload.visit as FieldVisitState;
  const consistent = review.visitId === visit.id
    && ((review.status === 'approved' && visit.status === 'completed')
      || (review.status === 'returned' && visit.status === 'in_progress'));
  if (!consistent || !inventoryHandoffValid(payload.inventoryHandoff, review) || !billingCandidateValid(payload.billingCandidate, review)
    || (review.status === 'returned' && (payload.inventoryHandoff !== null || payload.billingCandidate !== null))) {
    throw new Error('Field Operations returned contradictory Office Review decision data. Refresh and try again.');
  }
  return payload as FieldDecideOfficeReviewResponse;
}
