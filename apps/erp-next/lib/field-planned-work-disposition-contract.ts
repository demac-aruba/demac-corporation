import { FIELD_ALLOWED_ACTIONS, FIELD_AUTHORITY_API_VERSION, type FieldAllowedAction } from './field-authority-contract';
import {
  parseFieldProfessionalReportJobResponse,
  type FieldProfessionalReportJobDetail,
} from './field-professional-report-contract';

const REASONS = new Set([
  'customer_cancelled',
  'inaccessible',
  'unsafe',
  'deferred',
  'equipment_unavailable',
  'other',
] as const);
const MUTABLE_VISIT_STATUSES = new Set(['on_site', 'in_progress', 'pending']);
const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);

export type FieldPlannedWorkDispositionReason =
  | 'customer_cancelled'
  | 'inaccessible'
  | 'unsafe'
  | 'deferred'
  | 'equipment_unavailable'
  | 'other';

export type FieldPlannedWorkDisposition = {
  id: string;
  visitId: string;
  workOrderId: string;
  customerId: string;
  propertyId: string;
  plannedWorkLineId: string;
  quantity: number;
  reasonCode: FieldPlannedWorkDispositionReason;
  note?: string;
  createdAt: string;
  createdBy: string;
  version: 1;
};

export type FieldDispositionPlannedWorkProgress = {
  id: string;
  plannedQuantity: number;
  linkedActualQuantity: number;
  disposedQuantity: number;
  remainingQuantity: number;
};

export type FieldPlannedWorkDispositionOption = {
  plannedWorkLineId: string;
  maxQuantity: number;
};

export type FieldPlannedWorkDispositionJobDetail = Omit<FieldProfessionalReportJobDetail, 'plannedWorkProgress'> & {
  plannedWorkProgress: FieldDispositionPlannedWorkProgress[];
  plannedWorkDispositions: FieldPlannedWorkDisposition[];
  plannedWorkDispositionOptions: FieldPlannedWorkDispositionOption[];
  canRecordPlannedWorkDisposition: boolean;
};

export type FieldRecordPlannedWorkDispositionResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  disposition: FieldPlannedWorkDisposition;
  allowedActions: FieldAllowedAction[];
  auditEventId?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function optionalString(value: unknown) { return value === undefined || typeof value === 'string'; }
function timestamp(value: unknown) { return string(value) && Number.isFinite(Date.parse(value)); }
function positiveSafeInteger(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1; }
function nonNegativeSafeInteger(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value) && value.every((action) => typeof action === 'string' && ALLOWED_ACTIONS.has(action));
}

function dispositionValid(value: unknown): value is FieldPlannedWorkDisposition {
  const item = record(value);
  if (!item || !string(item.reasonCode) || !REASONS.has(item.reasonCode as FieldPlannedWorkDispositionReason)) return false;
  return string(item.id)
    && string(item.visitId)
    && string(item.workOrderId)
    && string(item.customerId)
    && string(item.propertyId)
    && string(item.plannedWorkLineId)
    && positiveSafeInteger(item.quantity)
    && optionalString(item.note)
    && (item.reasonCode !== 'other' || (typeof item.note === 'string' && item.note.trim().length >= 3))
    && timestamp(item.createdAt)
    && string(item.createdBy)
    && item.version === 1;
}

function optionValid(value: unknown): value is FieldPlannedWorkDispositionOption {
  const item = record(value);
  return Boolean(item && string(item.plannedWorkLineId) && positiveSafeInteger(item.maxQuantity));
}

function relationsValid(job: FieldPlannedWorkDispositionJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  const plannedLineIds = new Set(job.plannedWork.map((line) => line.id));
  const progressById = new Map(job.plannedWorkProgress.map((line) => [line.id, line]));
  if (job.plannedWorkProgress.length !== job.plannedWork.length) return false;

  const disposedByLine = new Map<string, number>();
  for (const disposition of job.plannedWorkDispositions) {
    if (!visitId
      || disposition.visitId !== visitId
      || disposition.workOrderId !== job.workOrderId
      || disposition.customerId !== job.customerId
      || disposition.propertyId !== job.propertyId
      || !plannedLineIds.has(disposition.plannedWorkLineId)) return false;
    disposedByLine.set(disposition.plannedWorkLineId, (disposedByLine.get(disposition.plannedWorkLineId) ?? 0) + disposition.quantity);
  }

  for (const planned of job.plannedWork) {
    const progress = progressById.get(planned.id);
    if (!progress
      || !nonNegativeSafeInteger(progress.plannedQuantity)
      || !nonNegativeSafeInteger(progress.linkedActualQuantity)
      || !nonNegativeSafeInteger(progress.disposedQuantity)
      || !nonNegativeSafeInteger(progress.remainingQuantity)
      || progress.plannedQuantity !== planned.quantity
      || progress.disposedQuantity !== (disposedByLine.get(planned.id) ?? 0)
      || progress.linkedActualQuantity + progress.disposedQuantity + progress.remainingQuantity !== progress.plannedQuantity) return false;
  }

  const expectedOptions = job.plannedWorkProgress
    .filter((line) => line.remainingQuantity > 0)
    .map((line) => ({ plannedWorkLineId: line.id, maxQuantity: line.remainingQuantity }));
  if (job.plannedWorkDispositionOptions.length !== expectedOptions.length) return false;
  if (!expectedOptions.every((expected, index) => {
    const actual = job.plannedWorkDispositionOptions[index];
    return actual.plannedWorkLineId === expected.plannedWorkLineId && actual.maxQuantity === expected.maxQuantity;
  })) return false;

  const serverEligible = Boolean(job.fieldVisit
    && MUTABLE_VISIT_STATUSES.has(job.fieldVisit.status)
    && job.allowedActions.includes('intervention.complete')
    && expectedOptions.length > 0);
  return job.canRecordPlannedWorkDisposition === serverEligible;
}

export function parseFieldPlannedWorkDispositionJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldPlannedWorkDispositionJobDetail;
} {
  const base = parseFieldProfessionalReportJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  if (!rawJob
    || !Array.isArray(rawJob.plannedWorkDispositions)
    || !rawJob.plannedWorkDispositions.every(dispositionValid)
    || !Array.isArray(rawJob.plannedWorkProgress)
    || !rawJob.plannedWorkProgress.every((candidate) => {
      const item = record(candidate);
      return Boolean(item && string(item.id)
        && nonNegativeSafeInteger(item.plannedQuantity)
        && nonNegativeSafeInteger(item.linkedActualQuantity)
        && nonNegativeSafeInteger(item.disposedQuantity)
        && nonNegativeSafeInteger(item.remainingQuantity));
    })
    || !Array.isArray(rawJob.plannedWorkDispositionOptions)
    || !rawJob.plannedWorkDispositionOptions.every(optionValid)
    || typeof rawJob.canRecordPlannedWorkDisposition !== 'boolean') {
    throw new Error('Field Operations returned malformed Planned Work Disposition data. Refresh and try again.');
  }

  const job = {
    ...base.job,
    plannedWorkProgress: rawJob.plannedWorkProgress,
    plannedWorkDispositions: rawJob.plannedWorkDispositions,
    plannedWorkDispositionOptions: rawJob.plannedWorkDispositionOptions,
    canRecordPlannedWorkDisposition: rawJob.canRecordPlannedWorkDisposition,
  } as FieldPlannedWorkDispositionJobDetail;
  if (!relationsValid(job)) {
    throw new Error('Field Operations returned inconsistent Planned Work Disposition data. Refresh and try again.');
  }
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldRecordPlannedWorkDispositionResponse(value: unknown): FieldRecordPlannedWorkDispositionResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !dispositionValid(payload.disposition)
    || !allowedActionsValid(payload.allowedActions)
    || !(payload.auditEventId === undefined || typeof payload.auditEventId === 'string')) {
    throw new Error('Field Operations returned malformed Planned Work Disposition mutation data. Refresh and try again.');
  }
  return payload as FieldRecordPlannedWorkDispositionResponse;
}
