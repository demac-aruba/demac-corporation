import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  type FieldAllowedAction,
} from './field-authority-contract';
import {
  parseFieldCreateAdditionalInterventionResponse,
  parseFieldCreatePlannedInterventionResponse,
  parseFieldExecutionJobResponse,
  type FieldExecutionJobDetail as FieldInterventionExecutionJobDetail,
  type FieldScopeChange,
  type FieldWorkIntervention,
} from './field-intervention-contract';

const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled'] as const);
const APPROVAL_METHODS = new Set(['signature', 'verbal', 'whatsapp', 'email', 'office_recorded', 'other'] as const);
const APPROVAL_REFERENCE_TYPES = new Set(['intervention', 'sale_line', 'scope_change'] as const);
const ADDITIONAL_INTERVENTION_ORIGINS = new Set([
  'added_on_site_client_request',
  'added_on_site_technician_discovery',
] as const);
const APPROVED_ADDITIONAL_STATUSES = new Set(['confirmed', 'in_progress', 'pending_part', 'completed'] as const);
const APPROVAL_VISIT_STATUSES = new Set(['on_site', 'in_progress'] as const);
const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);

export type FieldApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type FieldApprovalMethod = 'signature' | 'verbal' | 'whatsapp' | 'email' | 'office_recorded' | 'other';
export type FieldApprovalReferenceType = 'intervention' | 'sale_line' | 'scope_change';
export type FieldAdditionalWorkDecision = 'approved' | 'rejected';

export type FieldApprovalReference = {
  type: FieldApprovalReferenceType;
  id: string;
};

export type FieldApproval = {
  id: string;
  visitId: string;
  status: FieldApprovalStatus;
  method: FieldApprovalMethod;
  affected: FieldApprovalReference[];
  receiverName: string;
  decidedAt?: string;
  technicianStaffId?: string;
  signatureEvidenceId?: string;
  note?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldExecutionJobDetail = FieldInterventionExecutionJobDetail & {
  fieldApprovals: FieldApproval[];
  additionalApprovalInterventionIds: string[];
  canRecordAdditionalApproval: boolean;
};

export type FieldRecordAdditionalWorkDecisionResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  fieldApproval: FieldApproval;
  scopeChange: FieldScopeChange;
  workIntervention: FieldWorkIntervention;
  allowedActions: FieldAllowedAction[];
  auditEventId?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function timestamp(value: unknown) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function optionalTimestamp(value: unknown) {
  return value === undefined || timestamp(value);
}

function positiveSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value) || !value.every(nonEmptyString)) return false;
  return value.length === new Set(value).size;
}

function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value)
    && value.every((action) => typeof action === 'string' && ALLOWED_ACTIONS.has(action));
}

function affectedValid(value: unknown): value is FieldApprovalReference[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const keys = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !nonEmptyString(item.type) || !nonEmptyString(item.id)) return false;
    if (!APPROVAL_REFERENCE_TYPES.has(item.type as FieldApprovalReferenceType)) return false;
    const key = `${item.type}:${item.id}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

export function fieldApprovalValid(value: unknown): value is FieldApproval {
  const item = record(value);
  if (!item || !nonEmptyString(item.status) || !APPROVAL_STATUSES.has(item.status as FieldApprovalStatus)) return false;
  if (!nonEmptyString(item.method) || !APPROVAL_METHODS.has(item.method as FieldApprovalMethod)) return false;
  if ((item.status === 'approved' || item.status === 'rejected') && !timestamp(item.decidedAt)) return false;
  return nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && affectedValid(item.affected)
    && nonEmptyString(item.receiverName)
    && optionalTimestamp(item.decidedAt)
    && optionalString(item.technicianStaffId)
    && optionalString(item.signatureEvidenceId)
    && optionalString(item.note)
    && timestamp(item.createdAt)
    && nonEmptyString(item.createdBy)
    && timestamp(item.updatedAt)
    && nonEmptyString(item.updatedBy)
    && positiveSafeInteger(item.version);
}

function affectedId(approval: FieldApproval, type: FieldApprovalReferenceType) {
  return approval.affected.find((reference) => reference.type === type)?.id ?? '';
}

function validateActivatedApprovalRelations(job: FieldExecutionJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  if ((job.fieldApprovals.length > 0 || job.additionalApprovalInterventionIds.length > 0) && !visitId) return false;
  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const scopeById = new Map(job.scopeChanges.map((scopeChange) => [scopeChange.id, scopeChange]));
  const approvalByInterventionId = new Map<string, FieldApproval>();
  const saleApprovalIds = new Set<string>();

  for (const approval of job.fieldApprovals) {
    if (approval.visitId !== visitId) return false;
    const saleLineId = affectedId(approval, 'sale_line');
    if (saleLineId) {
      if (approval.affected.length !== 1 || !['approved', 'rejected'].includes(approval.status) || saleApprovalIds.has(saleLineId)) return false;
      saleApprovalIds.add(saleLineId);
      continue;
    }
    const interventionId = affectedId(approval, 'intervention');
    const scopeChangeId = affectedId(approval, 'scope_change');
    if (!interventionId || !scopeChangeId || approval.affected.length !== 2 || approvalByInterventionId.has(interventionId)) return false;
    const intervention = interventionById.get(interventionId);
    const scopeChange = scopeById.get(scopeChangeId);
    if (!intervention || !scopeChange
      || !ADDITIONAL_INTERVENTION_ORIGINS.has(intervention.origin as 'added_on_site_client_request' | 'added_on_site_technician_discovery')
      || intervention.scopeChangeId !== scopeChange.id
      || scopeChange.interventionId !== intervention.id
      || !scopeChange.resolvedAt) return false;
    if (approval.status === 'approved') {
      if (!APPROVED_ADDITIONAL_STATUSES.has(intervention.status as 'confirmed' | 'in_progress' | 'pending_part' | 'completed')) return false;
    } else if (approval.status === 'rejected') {
      if (intervention.status !== 'declined') return false;
    } else {
      return false;
    }
    approvalByInterventionId.set(interventionId, approval);
  }

  for (const intervention of job.workInterventions) {
    if (!ADDITIONAL_INTERVENTION_ORIGINS.has(intervention.origin as 'added_on_site_client_request' | 'added_on_site_technician_discovery')) continue;
    const scopeChange = intervention.scopeChangeId ? scopeById.get(intervention.scopeChangeId) : undefined;
    if (!scopeChange) return false;
    const approval = approvalByInterventionId.get(intervention.id);
    if (intervention.status === 'pending_authorization') {
      if (scopeChange.resolvedAt || approval) return false;
      continue;
    }
    if (intervention.status === 'declined') {
      if (!scopeChange.resolvedAt || approval?.status !== 'rejected') return false;
      continue;
    }
    if (APPROVED_ADDITIONAL_STATUSES.has(intervention.status as 'confirmed' | 'in_progress' | 'pending_part' | 'completed')) {
      if (!scopeChange.resolvedAt || approval?.status !== 'approved') return false;
      continue;
    }
    return false;
  }

  for (const interventionId of job.additionalApprovalInterventionIds) {
    const intervention = interventionById.get(interventionId);
    const scopeChange = intervention?.scopeChangeId ? scopeById.get(intervention.scopeChangeId) : undefined;
    if (!intervention
      || !ADDITIONAL_INTERVENTION_ORIGINS.has(intervention.origin as 'added_on_site_client_request' | 'added_on_site_technician_discovery')
      || intervention.status !== 'pending_authorization'
      || !intervention.priceSnapshot
      || !scopeChange
      || scopeChange.resolvedAt) return false;
  }

  if (job.canRecordAdditionalApproval !== (job.additionalApprovalInterventionIds.length > 0)) return false;
  if (job.canRecordAdditionalApproval) {
    if (!job.fieldVisit
      || !APPROVAL_VISIT_STATUSES.has(job.fieldVisit.status as 'on_site' | 'in_progress')
      || !job.allowedActions.includes('execute')) return false;
  }
  return true;
}

function parseGenericWorkIntervention(value: unknown, allowedActions: unknown, auditEventId?: unknown) {
  return parseFieldCreatePlannedInterventionResponse({
    success: true,
    version: FIELD_AUTHORITY_API_VERSION,
    replayed: false,
    workIntervention: value,
    allowedActions,
    auditEventId,
  }).workIntervention;
}

function parseAdditionalPair(scopeChange: unknown, workIntervention: FieldWorkIntervention, allowedActions: unknown) {
  return parseFieldCreateAdditionalInterventionResponse({
    success: true,
    version: FIELD_AUTHORITY_API_VERSION,
    replayed: false,
    scopeChange,
    workIntervention: { ...workIntervention, status: 'pending_authorization' },
    allowedActions,
  }).scopeChange;
}

export function parseFieldApprovalJobResponse(value: unknown): { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; job: FieldExecutionJobDetail } {
  const base = parseFieldExecutionJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  if (!rawJob
    || !Array.isArray(rawJob.fieldApprovals)
    || !rawJob.fieldApprovals.every(fieldApprovalValid)
    || !uniqueStrings(rawJob.additionalApprovalInterventionIds)
    || typeof rawJob.canRecordAdditionalApproval !== 'boolean') {
    throw new Error('Field Operations returned malformed approval data. Refresh and try again.');
  }
  const job = base.job as FieldExecutionJobDetail;
  if (!validateActivatedApprovalRelations(job)) {
    throw new Error('Field Operations returned inconsistent approval data. Refresh and try again.');
  }
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldRecordAdditionalWorkDecisionResponse(value: unknown): FieldRecordAdditionalWorkDecisionResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !fieldApprovalValid(payload.fieldApproval)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed customer-decision data. Refresh and try again.');
  }

  const workIntervention = parseGenericWorkIntervention(payload.workIntervention, payload.allowedActions, payload.auditEventId);
  const scopeChange = parseAdditionalPair(payload.scopeChange, workIntervention, payload.allowedActions);
  const fieldApproval = payload.fieldApproval as FieldApproval;
  const expectedStatus = fieldApproval.status === 'approved' ? 'confirmed' : fieldApproval.status === 'rejected' ? 'declined' : '';
  if (!expectedStatus
    || fieldApproval.method !== 'verbal'
    || fieldApproval.visitId !== workIntervention.visitId
    || scopeChange.visitId !== workIntervention.visitId
    || scopeChange.interventionId !== workIntervention.id
    || workIntervention.scopeChangeId !== scopeChange.id
    || !scopeChange.resolvedAt
    || !fieldApproval.decidedAt
    || fieldApproval.decidedAt !== scopeChange.resolvedAt
    || workIntervention.status !== expectedStatus
    || fieldApproval.affected.length !== 2
    || affectedId(fieldApproval, 'intervention') !== workIntervention.id
    || affectedId(fieldApproval, 'scope_change') !== scopeChange.id) {
    throw new Error('Field Operations returned inconsistent customer-decision data. Refresh and try again.');
  }
  return {
    ...payload,
    fieldApproval,
    scopeChange,
    workIntervention,
  } as FieldRecordAdditionalWorkDecisionResponse;
}
