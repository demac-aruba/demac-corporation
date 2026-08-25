import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  parseFieldJobResponse,
  type FieldAllowedAction,
  type FieldJobDetail,
} from './field-authority-contract';

const WORK_INTERVENTION_ORIGINS = new Set([
  'planned',
  'added_on_site_client_request',
  'added_on_site_technician_discovery',
  'converted_on_site',
  'office_added',
] as const);
const WORK_INTERVENTION_STATUSES = new Set([
  'planned',
  'confirmed',
  'in_progress',
  'pending_authorization',
  'pending_part',
  'not_performed',
  'declined',
  'cancelled',
  'completed',
] as const);
const WORK_INTERVENTION_REQUESTERS = new Set(['office', 'client', 'technician'] as const);
const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);

export type FieldWorkInterventionOrigin =
  | 'planned'
  | 'added_on_site_client_request'
  | 'added_on_site_technician_discovery'
  | 'converted_on_site'
  | 'office_added';
export type FieldWorkInterventionStatus =
  | 'planned'
  | 'confirmed'
  | 'in_progress'
  | 'pending_authorization'
  | 'pending_part'
  | 'not_performed'
  | 'declined'
  | 'cancelled'
  | 'completed';
export type FieldWorkInterventionRequester = 'office' | 'client' | 'technician';

export type FieldWorkIntervention = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  plannedWorkLineId?: string;
  serviceCatalogItemId: string;
  interventionType: string;
  origin: FieldWorkInterventionOrigin;
  requestedBy?: FieldWorkInterventionRequester;
  status: FieldWorkInterventionStatus;
  templateId?: string;
  templateVersion?: number;
  scopeChangeId?: string;
  startedAt?: string;
  completedAt?: string;
  performedByStaffIds: string[];
  resultCode?: string;
  resultNotes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldPlannedWorkProgress = {
  id: string;
  plannedQuantity: number;
  linkedActualQuantity: number;
  remainingQuantity: number;
};

export type FieldPlannedInterventionOption = {
  visitAssetId: string;
  plannedWorkLineIds: string[];
};

export type FieldAvailableService = {
  id: string;
  bookingCode: string;
  label: string;
  kind: string;
  durationMinutesPerUnit: number;
};

export type FieldExecutionJobDetail = FieldJobDetail & {
  workInterventions: FieldWorkIntervention[];
  plannedWorkProgress: FieldPlannedWorkProgress[];
  plannedInterventionOptions: FieldPlannedInterventionOption[];
  availableFieldServices: FieldAvailableService[];
  canAddPlannedIntervention: boolean;
};

export type FieldCreatePlannedInterventionResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  workIntervention: FieldWorkIntervention;
  allowedActions: FieldAllowedAction[];
  auditEventId?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function positiveSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function nonNegativeFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nonNegativeSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function uniqueStrings(value: unknown, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  if (!value.every(string)) return false;
  return value.length === new Set(value).size;
}

function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value)
    && value.every((action) => typeof action === 'string' && ALLOWED_ACTIONS.has(action));
}

function workInterventionValid(value: unknown): value is FieldWorkIntervention {
  const item = record(value);
  if (!item) return false;
  const origin = typeof item.origin === 'string' ? item.origin : '';
  const status = typeof item.status === 'string' ? item.status : '';
  const requester = item.requestedBy === undefined ? '' : typeof item.requestedBy === 'string' ? item.requestedBy : '__invalid__';
  if (!WORK_INTERVENTION_ORIGINS.has(origin as FieldWorkInterventionOrigin)) return false;
  if (!WORK_INTERVENTION_STATUSES.has(status as FieldWorkInterventionStatus)) return false;
  if (requester && !WORK_INTERVENTION_REQUESTERS.has(requester as FieldWorkInterventionRequester)) return false;
  if (origin === 'planned' && !string(item.plannedWorkLineId)) return false;
  if (origin !== 'planned' && !string(item.scopeChangeId)) return false;
  return string(item.id)
    && string(item.visitId)
    && string(item.visitAssetId)
    && string(item.assetId)
    && optionalString(item.plannedWorkLineId)
    && string(item.serviceCatalogItemId)
    && string(item.interventionType)
    && optionalString(item.templateId)
    && (item.templateVersion === undefined || positiveSafeInteger(item.templateVersion))
    && optionalString(item.scopeChangeId)
    && optionalString(item.startedAt)
    && optionalString(item.completedAt)
    && uniqueStrings(item.performedByStaffIds)
    && optionalString(item.resultCode)
    && optionalString(item.resultNotes)
    && string(item.createdAt)
    && string(item.createdBy)
    && string(item.updatedAt)
    && string(item.updatedBy)
    && positiveSafeInteger(item.version);
}

function plannedWorkProgressValid(value: unknown): value is FieldPlannedWorkProgress[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !string(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
    if (!nonNegativeFiniteNumber(item.plannedQuantity)
      || !nonNegativeSafeInteger(item.linkedActualQuantity)
      || !nonNegativeFiniteNumber(item.remainingQuantity)) return false;
  }
  return true;
}

function plannedInterventionOptionsValid(value: unknown): value is FieldPlannedInterventionOption[] {
  if (!Array.isArray(value)) return false;
  const visitAssetIds = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !string(item.visitAssetId) || visitAssetIds.has(item.visitAssetId)) return false;
    visitAssetIds.add(item.visitAssetId);
    if (!uniqueStrings(item.plannedWorkLineIds, { allowEmpty: false })) return false;
  }
  return true;
}

function availableServicesValid(value: unknown): value is FieldAvailableService[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !string(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
    if (!string(item.bookingCode)
      || !string(item.label)
      || !string(item.kind)
      || !nonNegativeFiniteNumber(item.durationMinutesPerUnit)) return false;
  }
  return true;
}

function executionRelationsValid(job: FieldExecutionJobDetail) {
  const currentVisitId = job.fieldVisit?.id ?? '';
  const assetByVisitAssetId = new Map(job.visitAssets.map((asset) => [asset.id, asset]));
  const progressById = new Map(job.plannedWorkProgress.map((progress) => [progress.id, progress]));

  if (job.workInterventions.length > 0 && !currentVisitId) return false;
  for (const intervention of job.workInterventions) {
    const visitAsset = assetByVisitAssetId.get(intervention.visitAssetId);
    if (!visitAsset || intervention.visitId !== currentVisitId || intervention.assetId !== visitAsset.assetId) return false;
    if (intervention.plannedWorkLineId && !progressById.has(intervention.plannedWorkLineId)) return false;
  }

  for (const option of job.plannedInterventionOptions) {
    if (!assetByVisitAssetId.has(option.visitAssetId)) return false;
    if (option.plannedWorkLineIds.some((id) => !progressById.has(id))) return false;
  }

  if (job.canAddPlannedIntervention
    && (job.plannedInterventionOptions.length === 0 || job.availableFieldServices.length === 0)) return false;
  return true;
}

export function parseFieldExecutionJobResponse(value: unknown): { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; job: FieldExecutionJobDetail } {
  const base = parseFieldJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  if (!payload || !rawJob
    || !Array.isArray(rawJob.workInterventions)
    || !rawJob.workInterventions.every(workInterventionValid)
    || !plannedWorkProgressValid(rawJob.plannedWorkProgress)
    || !plannedInterventionOptionsValid(rawJob.plannedInterventionOptions)
    || !availableServicesValid(rawJob.availableFieldServices)
    || typeof rawJob.canAddPlannedIntervention !== 'boolean') {
    throw new Error('Field Operations returned malformed intervention data. Refresh and try again.');
  }
  const job = base.job as FieldExecutionJobDetail;
  if (!executionRelationsValid(job)) {
    throw new Error('Field Operations returned inconsistent intervention data. Refresh and try again.');
  }
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldCreatePlannedInterventionResponse(value: unknown): FieldCreatePlannedInterventionResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !workInterventionValid(payload.workIntervention)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed Work Intervention data. Refresh and try again.');
  }
  return payload as FieldCreatePlannedInterventionResponse;
}
