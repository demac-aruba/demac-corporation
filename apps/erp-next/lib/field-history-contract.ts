import {
  parseFieldOfficeReviewJobResponse,
  type FieldOfficeReviewJobDetail,
} from './field-office-review-contract';
import type { FieldPriceSnapshot } from './field-intervention-contract';
import type { FieldVisitStatus } from './field-authority-contract';
import type { FieldWorkInterventionOrigin, FieldWorkInterventionStatus } from './field-intervention-contract';
import type { FieldSaleLineStatus } from './field-sale-contract';

const SALE_STATUSES = new Set(['proposed', 'customer_approved', 'installed', 'delivered', 'sold', 'declined', 'voided'] as const);
const VISIT_STATUSES = new Set(['scheduled', 'en_route', 'on_site', 'in_progress', 'pending', 'requires_return_visit', 'ready_for_office_review', 'completed', 'no_access', 'cancelled'] as const);
const INTERVENTION_ORIGINS = new Set(['planned', 'added_on_site_client_request', 'added_on_site_technician_discovery', 'converted_on_site', 'office_added'] as const);
const INTERVENTION_STATUSES = new Set(['planned', 'confirmed', 'in_progress', 'pending_authorization', 'pending_part', 'not_performed', 'declined', 'cancelled', 'completed'] as const);

export type FieldCustomerHistoryVisit = {
  id: string; workOrderId: string; propertyId: string; status: FieldVisitStatus;
  startedAt?: string; completedAt?: string; requiresSecondVisit: boolean; updatedAt: string;
};
export type FieldCustomerHistoryIntervention = {
  id: string; visitId: string; workOrderId: string; propertyId: string; assetId: string;
  serviceCatalogItemId: string; interventionType: string; origin: FieldWorkInterventionOrigin; status: FieldWorkInterventionStatus;
  resultCode?: string; resultNotes?: string; startedAt?: string; completedAt?: string; updatedAt: string;
};
export type FieldCustomerHistorySaleLine = {
  id: string; visitId: string; workOrderId: string; propertyId: string; assetId?: string;
  catalogItemId?: string; descriptionSnapshot: string; quantity: number; unit: string;
  priceSnapshot?: FieldPriceSnapshot; status: FieldSaleLineStatus; customerApprovalId?: string;
  nonCatalog: boolean; updatedAt: string;
};
export type FieldCustomerHistoryFinding = {
  id: string; visitId: string; workOrderId: string; propertyId: string; assetId: string;
  interventionId: string; summary: string; details: string; recommendation?: string; observedAt: string;
};
export type FieldCustomerHistory = {
  version: 1;
  source: 'canonical_field_truth';
  customerId: string;
  visits: FieldCustomerHistoryVisit[];
  interventions: FieldCustomerHistoryIntervention[];
  saleLines: FieldCustomerHistorySaleLine[];
  findings: FieldCustomerHistoryFinding[];
};
export type FieldEquipmentHistory = {
  assetId: string;
  locationLabel?: string;
  interventionIds: string[];
  findingIds: string[];
  saleLineIds: string[];
};
export type FieldHistoryJobDetail = FieldOfficeReviewJobDetail & {
  customerFieldHistory: FieldCustomerHistory;
  equipmentFieldHistories: FieldEquipmentHistory[];
};

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function optionalString(value: unknown) { return value === undefined || typeof value === 'string'; }
function timestamp(value: unknown) { return string(value) && Number.isFinite(Date.parse(value)); }
function quantity(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10000 && Number.isInteger(value * 1000); }
function money(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.round(value * 100) === value * 100; }

function priceValid(value: unknown, catalogItemId: unknown, quantityValue: unknown): value is FieldPriceSnapshot {
  const price = record(value);
  return Boolean(price && string(price.currency) && money(price.unitPrice) && money(price.lineTotal)
    && price.lineTotal === Math.round((price.unitPrice as number) * (quantityValue as number) * 100) / 100
    && price.sourceCatalogItemId === catalogItemId && (string(price.pricingVersion) || (typeof price.pricingVersion === 'number' && Number.isSafeInteger(price.pricingVersion) && price.pricingVersion >= 1))
    && timestamp(price.capturedAt) && (price.discountAmount === undefined || money(price.discountAmount))
    && (price.taxAmount === undefined || money(price.taxAmount)));
}

function uniqueIds(values: unknown[]) { return values.every(string) && new Set(values).size === values.length; }

function historyValid(value: unknown, job: FieldOfficeReviewJobDetail): value is FieldCustomerHistory {
  const history = record(value);
  if (!history || history.version !== 1 || history.source !== 'canonical_field_truth' || history.customerId !== job.customerId
    || !Array.isArray(history.visits) || !Array.isArray(history.interventions) || !Array.isArray(history.saleLines) || !Array.isArray(history.findings)) return false;
  const visits = history.visits.map(record);
  const interventions = history.interventions.map(record);
  const saleLines = history.saleLines.map(record);
  const findings = history.findings.map(record);
  if (visits.some((visit) => !visit || !string(visit.id) || !string(visit.workOrderId) || !string(visit.propertyId)
      || !string(visit.status) || !VISIT_STATUSES.has(visit.status as FieldVisitStatus)
      || !optionalString(visit.startedAt) || (visit.startedAt !== undefined && !timestamp(visit.startedAt))
      || !optionalString(visit.completedAt) || (visit.completedAt !== undefined && !timestamp(visit.completedAt))
      || typeof visit.requiresSecondVisit !== 'boolean' || !timestamp(visit.updatedAt))
    || !uniqueIds(visits.map((visit) => visit?.id))) return false;
  const visitById = new Map(visits.map((visit) => [visit?.id, visit]));
  if (interventions.some((entry) => {
    const intervention = entry; const visit = intervention ? visitById.get(intervention.visitId) : null;
    return !intervention || !visit || !string(intervention.id) || intervention.workOrderId !== visit.workOrderId || intervention.propertyId !== visit.propertyId
      || !string(intervention.assetId) || !string(intervention.serviceCatalogItemId) || typeof intervention.interventionType !== 'string'
      || !string(intervention.origin) || !INTERVENTION_ORIGINS.has(intervention.origin as FieldWorkInterventionOrigin)
      || !string(intervention.status) || !INTERVENTION_STATUSES.has(intervention.status as FieldWorkInterventionStatus)
      || !optionalString(intervention.resultCode) || !optionalString(intervention.resultNotes)
      || !optionalString(intervention.startedAt) || (intervention.startedAt !== undefined && !timestamp(intervention.startedAt))
      || !optionalString(intervention.completedAt) || (intervention.completedAt !== undefined && !timestamp(intervention.completedAt)) || !timestamp(intervention.updatedAt);
  }) || !uniqueIds(interventions.map((entry) => entry?.id))) return false;
  const interventionById = new Map(interventions.map((entry) => [entry?.id, entry]));
  const currentVisit = job.fieldVisit ? visitById.get(job.fieldVisit.id) : null;
  if (job.fieldVisit && (!currentVisit || currentVisit.workOrderId !== job.workOrderId || currentVisit.propertyId !== job.propertyId)) return false;
  if (saleLines.some((entry) => {
    const line = entry; const visit = line ? visitById.get(line.visitId) : null;
    if (!line || !visit || !string(line.id) || line.workOrderId !== visit.workOrderId || line.propertyId !== visit.propertyId
      || !optionalString(line.assetId) || !optionalString(line.catalogItemId) || !string(line.descriptionSnapshot) || !quantity(line.quantity)
      || !string(line.unit) || !string(line.status) || !SALE_STATUSES.has(line.status as FieldSaleLineStatus)
      || !optionalString(line.customerApprovalId) || typeof line.nonCatalog !== 'boolean' || !timestamp(line.updatedAt)) return true;
    if (['customer_approved', 'installed', 'delivered', 'sold', 'declined'].includes(line.status as string) && !string(line.customerApprovalId)) return true;
    return line.nonCatalog ? line.catalogItemId !== undefined || line.priceSnapshot !== undefined || !['proposed', 'voided'].includes(line.status as string)
      : !string(line.catalogItemId) || !priceValid(line.priceSnapshot, line.catalogItemId, line.quantity);
  }) || !uniqueIds(saleLines.map((entry) => entry?.id))) return false;
  if (findings.some((entry) => {
    const finding = entry; const visit = finding ? visitById.get(finding.visitId) : null;
    const intervention = finding ? interventionById.get(finding.interventionId) : null;
    return !finding || !visit || !intervention || !string(finding.id) || finding.workOrderId !== visit.workOrderId
      || finding.propertyId !== visit.propertyId || finding.assetId !== intervention.assetId || finding.visitId !== intervention.visitId
      || !string(finding.summary) || !string(finding.details) || !optionalString(finding.recommendation) || !timestamp(finding.observedAt);
  }) || !uniqueIds(findings.map((entry) => entry?.id))) return false;
  return true;
}

function equipmentHistoriesValid(value: unknown, history: FieldCustomerHistory, job: FieldOfficeReviewJobDetail): value is FieldEquipmentHistory[] {
  if (!Array.isArray(value)) return false;
  const items = value.map(record);
  if (items.some((item) => !item || !string(item.assetId) || !optionalString(item.locationLabel)
    || !Array.isArray(item.interventionIds) || !uniqueIds(item.interventionIds)
    || !Array.isArray(item.findingIds) || !uniqueIds(item.findingIds)
    || !Array.isArray(item.saleLineIds) || !uniqueIds(item.saleLineIds))
    || !uniqueIds(items.map((item) => item?.assetId))) return false;
  const expectedAssetIds = new Set([
    ...job.knownEquipment.map((asset) => asset.id), ...job.visitAssets.map((asset) => asset.assetId),
    ...history.interventions.map((entry) => entry.assetId), ...history.findings.map((entry) => entry.assetId),
    ...history.saleLines.map((entry) => entry.assetId).filter((assetId): assetId is string => Boolean(assetId)),
  ]);
  if (items.length !== expectedAssetIds.size || items.some((item) => !expectedAssetIds.has(item?.assetId as string))) return false;
  return items.every((item) => {
    const assetId = item?.assetId as string;
    const expectedInterventions = history.interventions.filter((entry) => entry.assetId === assetId).map((entry) => entry.id);
    const expectedFindings = history.findings.filter((entry) => entry.assetId === assetId).map((entry) => entry.id);
    const expectedSales = history.saleLines.filter((entry) => entry.assetId === assetId).map((entry) => entry.id);
    return (item?.interventionIds as string[]).length === expectedInterventions.length && expectedInterventions.every((id) => (item?.interventionIds as string[]).includes(id))
      && (item?.findingIds as string[]).length === expectedFindings.length && expectedFindings.every((id) => (item?.findingIds as string[]).includes(id))
      && (item?.saleLineIds as string[]).length === expectedSales.length && expectedSales.every((id) => (item?.saleLineIds as string[]).includes(id));
  });
}

export function parseFieldHistoryJobResponse(value: unknown): { success: true; version: 1; job: FieldHistoryJobDetail } {
  const base = parseFieldOfficeReviewJobResponse(value);
  const rawJob = record(record(value)?.job);
  if (!rawJob || !historyValid(rawJob.customerFieldHistory, base.job)) {
    throw new Error('Field Operations returned malformed canonical Customer history. Refresh and try again.');
  }
  const history = rawJob.customerFieldHistory as FieldCustomerHistory;
  if (!equipmentHistoriesValid(rawJob.equipmentFieldHistories, history, base.job)) {
    throw new Error('Field Operations returned inconsistent canonical Equipment history. Refresh and try again.');
  }
  return { success: true, version: 1, job: { ...base.job, customerFieldHistory: history, equipmentFieldHistories: rawJob.equipmentFieldHistories as FieldEquipmentHistory[] } };
}
