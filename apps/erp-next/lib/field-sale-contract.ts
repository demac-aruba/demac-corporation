import { FIELD_AUTHORITY_API_VERSION, type FieldAllowedAction } from './field-authority-contract';
import { fieldApprovalValid, type FieldApproval } from './field-approval-contract';
import type { FieldPriceSnapshot } from './field-intervention-contract';
import {
  parseFieldPlannedWorkDispositionJobResponse,
  type FieldPlannedWorkDispositionJobDetail,
} from './field-planned-work-disposition-contract';

const STATUSES = new Set(['proposed', 'customer_approved', 'installed', 'delivered', 'sold', 'declined', 'voided'] as const);
const ACTIVE_VISIT_STATUSES = new Set(['on_site', 'in_progress']);
const TRANSITIONS: Record<FieldSaleLineStatus, FieldSaleLineStatus[]> = {
  proposed: ['customer_approved', 'declined', 'voided'],
  customer_approved: ['installed', 'delivered', 'voided'],
  installed: ['sold'], delivered: ['sold'], sold: [], declined: [], voided: [],
};

export type FieldSaleLineStatus = 'proposed' | 'customer_approved' | 'installed' | 'delivered' | 'sold' | 'declined' | 'voided';
export type FieldSaleDecision = 'approved' | 'rejected';
export type FieldSaleExecutionTarget = 'installed' | 'delivered' | 'sold' | 'voided';

export type FieldSaleLine = {
  id: string; visitId: string; workOrderId: string; customerId: string; propertyId: string;
  interventionId?: string; assetId?: string; catalogItemId?: string; descriptionSnapshot: string;
  quantity: number; unit: string; priceSnapshot?: FieldPriceSnapshot; status: FieldSaleLineStatus;
  soldByStaffId: string; requiresCustomerApproval: boolean; customerApprovalId?: string;
  inventoryMovementId?: string; invoiceLineId?: string; nonCatalog: boolean;
  officeReviewRequired: boolean; notes?: string; createdAt: string; createdBy: string;
  updatedAt: string; updatedBy: string; version: number;
};

export type FieldSaleCatalogOption = {
  catalogItemId: string; label: string; description?: string; unit: string; priceSnapshot: FieldPriceSnapshot;
};
export type FieldSaleTransitionOption = { saleLineId: string; allowedTargets: FieldSaleLineStatus[] };
export type FieldSaleJobDetail = FieldPlannedWorkDispositionJobDetail & {
  fieldSaleLines: FieldSaleLine[];
  fieldSaleCatalogOptions: FieldSaleCatalogOption[];
  fieldSaleDecisionLineIds: string[];
  fieldSaleTransitionOptions: FieldSaleTransitionOption[];
  canAddFieldSaleLine: boolean;
  canAddNonCatalogFieldSaleLine: boolean;
  canRecordFieldSaleDecision: boolean;
};
export type FieldCreateSaleLineResponse = { success: true; version: 1; replayed: boolean; fieldSaleLine: FieldSaleLine };
export type FieldDecideSaleLineResponse = FieldCreateSaleLineResponse & { approval: FieldApproval };
export type FieldTransitionSaleLineResponse = FieldCreateSaleLineResponse;

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function optionalString(value: unknown) { return value === undefined || typeof value === 'string'; }
function timestamp(value: unknown) { return string(value) && Number.isFinite(Date.parse(value)); }
function positiveVersion(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1; }
function quantity(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10000 && Number.isInteger(value * 1000); }
function money(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.round(value * 100) === value * 100; }

function priceValid(value: unknown, catalogItemId: unknown, quantityValue?: number): value is FieldPriceSnapshot {
  const item = record(value);
  if (!item || !string(item.currency) || !money(item.unitPrice) || item.sourceCatalogItemId !== catalogItemId
    || !(string(item.pricingVersion) || positiveVersion(item.pricingVersion)) || !timestamp(item.capturedAt)
    || !(item.discountAmount === undefined || money(item.discountAmount))
    || !(item.taxAmount === undefined || money(item.taxAmount)) || !(item.lineTotal === undefined || money(item.lineTotal))) return false;
  if (quantityValue !== undefined && item.lineTotal !== Math.round((item.unitPrice as number) * quantityValue * 100) / 100) return false;
  return true;
}

export function fieldSaleLineValid(value: unknown): value is FieldSaleLine {
  const item = record(value);
  if (!item || !string(item.id) || !string(item.visitId) || !string(item.workOrderId) || !string(item.customerId)
    || !string(item.propertyId) || !optionalString(item.interventionId) || !optionalString(item.assetId)
    || !optionalString(item.catalogItemId) || !string(item.descriptionSnapshot) || !quantity(item.quantity)
    || !string(item.unit) || !string(item.status) || !STATUSES.has(item.status as FieldSaleLineStatus)
    || !string(item.soldByStaffId) || typeof item.requiresCustomerApproval !== 'boolean'
    || !optionalString(item.customerApprovalId) || !optionalString(item.inventoryMovementId) || !optionalString(item.invoiceLineId)
    || typeof item.nonCatalog !== 'boolean' || typeof item.officeReviewRequired !== 'boolean' || !optionalString(item.notes)
    || !timestamp(item.createdAt) || !string(item.createdBy) || !timestamp(item.updatedAt) || !string(item.updatedBy)
    || !positiveVersion(item.version)) return false;
  if (item.nonCatalog) return item.catalogItemId === undefined && item.priceSnapshot === undefined
    && item.officeReviewRequired === true && item.requiresCustomerApproval === false
    && ['proposed', 'voided'].includes(item.status as string);
  if (!string(item.catalogItemId) || !priceValid(item.priceSnapshot, item.catalogItemId, item.quantity as number)
    || item.officeReviewRequired !== false || item.requiresCustomerApproval !== true) return false;
  return !['customer_approved', 'installed', 'delivered', 'sold', 'declined'].includes(item.status as string) || string(item.customerApprovalId);
}

function validateJobRelations(job: FieldSaleJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  if ((job.fieldSaleLines.length || job.fieldSaleCatalogOptions.length) && !visitId) return false;
  const interventionIds = new Set(job.workInterventions.map((intervention) => intervention.id));
  const assetIds = new Set(job.visitAssets.map((asset) => asset.assetId));
  const approvalByLine = new Map<string, FieldApproval>();
  for (const approval of job.fieldApprovals) {
    const references = approval.affected.filter((reference) => reference.type === 'sale_line');
    if (!references.length) continue;
    if (references.length !== 1 || approval.affected.length !== 1 || approvalByLine.has(references[0].id)) return false;
    approvalByLine.set(references[0].id, approval);
  }
  if (new Set(job.fieldSaleLines.map((line) => line.id)).size !== job.fieldSaleLines.length
    || new Set(job.fieldSaleCatalogOptions.map((option) => option.catalogItemId)).size !== job.fieldSaleCatalogOptions.length) return false;
  for (const line of job.fieldSaleLines) {
    if (line.visitId !== visitId || line.workOrderId !== job.workOrderId || line.customerId !== job.customerId || line.propertyId !== job.propertyId
      || (line.interventionId !== undefined && !interventionIds.has(line.interventionId))
      || (line.assetId !== undefined && !assetIds.has(line.assetId))) return false;
    const approval = approvalByLine.get(line.id);
    if (line.status === 'proposed' && (approval || line.customerApprovalId)) return false;
    if (line.status === 'declined' && (approval?.status !== 'rejected' || approval.id !== line.customerApprovalId)) return false;
    if (['customer_approved', 'installed', 'delivered', 'sold'].includes(line.status)
      && (approval?.status !== 'approved' || approval.id !== line.customerApprovalId)) return false;
    if (line.status === 'voided' && (Boolean(approval) !== Boolean(line.customerApprovalId)
      || (approval && approval.id !== line.customerApprovalId))) return false;
  }
  const lineById = new Map(job.fieldSaleLines.map((line) => [line.id, line]));
  const eligible = Boolean(job.fieldVisit && ACTIVE_VISIT_STATUSES.has(job.fieldVisit.status) && job.allowedActions.includes('execute'));
  const expectedDecisionIds = eligible ? job.fieldSaleLines.filter((line) => !line.nonCatalog && line.status === 'proposed').map((line) => line.id) : [];
  if (new Set(job.fieldSaleDecisionLineIds).size !== job.fieldSaleDecisionLineIds.length
    || job.fieldSaleDecisionLineIds.length !== expectedDecisionIds.length
    || expectedDecisionIds.some((id) => !job.fieldSaleDecisionLineIds.includes(id))) return false;
  const expectedTransitions = eligible ? job.fieldSaleLines.map((line) => ({
    saleLineId: line.id,
    allowedTargets: TRANSITIONS[line.status].filter((target) => !['customer_approved', 'declined'].includes(target)),
  })).filter((option) => option.allowedTargets.length) : [];
  if (new Set(job.fieldSaleTransitionOptions.map((option) => option.saleLineId)).size !== job.fieldSaleTransitionOptions.length
    || job.fieldSaleTransitionOptions.length !== expectedTransitions.length
    || expectedTransitions.some((expected) => {
      const actual = job.fieldSaleTransitionOptions.find((option) => option.saleLineId === expected.saleLineId);
      return !actual || actual.allowedTargets.length !== expected.allowedTargets.length
        || expected.allowedTargets.some((target) => !actual.allowedTargets.includes(target));
    })) return false;
  return job.canAddNonCatalogFieldSaleLine === eligible
    && job.canAddFieldSaleLine === (eligible && job.fieldSaleCatalogOptions.length > 0)
    && job.canRecordFieldSaleDecision === (eligible && job.fieldSaleDecisionLineIds.length > 0);
}

function envelope(value: unknown) {
  const payload = record(value);
  if (!payload || payload.success !== true || payload.version !== FIELD_AUTHORITY_API_VERSION || typeof payload.replayed !== 'boolean') throw new Error('Field Operations returned malformed Field Sale data. Refresh and try again.');
  return payload;
}

export function parseFieldSaleJobResponse(value: unknown): { success: true; version: 1; job: FieldSaleJobDetail } {
  const base = parseFieldPlannedWorkDispositionJobResponse(value);
  const rawJob = record(record(value)?.job);
  if (!rawJob || !Array.isArray(rawJob.fieldSaleLines) || !rawJob.fieldSaleLines.every(fieldSaleLineValid)
    || !Array.isArray(rawJob.fieldSaleCatalogOptions) || !rawJob.fieldSaleCatalogOptions.every((candidate) => {
      const item = record(candidate);
      return Boolean(item && string(item.catalogItemId) && string(item.label) && optionalString(item.description)
        && string(item.unit) && priceValid(item.priceSnapshot, item.catalogItemId)
        && record(item.priceSnapshot)?.lineTotal === record(item.priceSnapshot)?.unitPrice);
    })
    || !Array.isArray(rawJob.fieldSaleDecisionLineIds) || !rawJob.fieldSaleDecisionLineIds.every(string)
    || !Array.isArray(rawJob.fieldSaleTransitionOptions) || !rawJob.fieldSaleTransitionOptions.every((candidate) => {
      const item = record(candidate);
      return Boolean(item && string(item.saleLineId) && Array.isArray(item.allowedTargets)
        && item.allowedTargets.every((target) => typeof target === 'string' && STATUSES.has(target as FieldSaleLineStatus)));
    })
    || typeof rawJob.canAddFieldSaleLine !== 'boolean' || typeof rawJob.canAddNonCatalogFieldSaleLine !== 'boolean'
    || typeof rawJob.canRecordFieldSaleDecision !== 'boolean') {
    throw new Error('Field Operations returned malformed Field Sale job data. Refresh and try again.');
  }
  const job = { ...base.job, fieldSaleLines: rawJob.fieldSaleLines, fieldSaleCatalogOptions: rawJob.fieldSaleCatalogOptions,
    fieldSaleDecisionLineIds: rawJob.fieldSaleDecisionLineIds, fieldSaleTransitionOptions: rawJob.fieldSaleTransitionOptions,
    canAddFieldSaleLine: rawJob.canAddFieldSaleLine, canAddNonCatalogFieldSaleLine: rawJob.canAddNonCatalogFieldSaleLine,
    canRecordFieldSaleDecision: rawJob.canRecordFieldSaleDecision } as FieldSaleJobDetail;
  if (!validateJobRelations(job)) throw new Error('Field Operations returned inconsistent Field Sale relations. Refresh and try again.');
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldCreateSaleLineResponse(value: unknown): FieldCreateSaleLineResponse {
  const payload = envelope(value);
  if (!fieldSaleLineValid(payload.fieldSaleLine)) throw new Error('Field Operations returned malformed Field Sale Line data. Refresh and try again.');
  return payload as FieldCreateSaleLineResponse;
}
export function parseFieldDecideSaleLineResponse(value: unknown): FieldDecideSaleLineResponse {
  const payload = envelope(value);
  if (!fieldSaleLineValid(payload.fieldSaleLine) || !fieldApprovalValid(payload.approval)) throw new Error('Field Operations returned malformed Field Sale decision data. Refresh and try again.');
  const line = payload.fieldSaleLine as FieldSaleLine; const approval = payload.approval as FieldApproval;
  const reference = approval.affected.length === 1 ? approval.affected[0] : null;
  const expected = approval.status === 'approved' ? 'customer_approved' : approval.status === 'rejected' ? 'declined' : '';
  if (!reference || reference.type !== 'sale_line' || reference.id !== line.id || approval.id !== line.customerApprovalId
    || approval.visitId !== line.visitId || line.status !== expected) throw new Error('Field Operations returned inconsistent Field Sale decision data. Refresh and try again.');
  return payload as FieldDecideSaleLineResponse;
}
export function parseFieldTransitionSaleLineResponse(value: unknown): FieldTransitionSaleLineResponse {
  return parseFieldCreateSaleLineResponse(value);
}

export type { FieldAllowedAction };
