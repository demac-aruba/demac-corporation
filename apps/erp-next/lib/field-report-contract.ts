import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  type FieldAllowedAction,
} from './field-authority-contract';
import {
  parseFieldApprovalJobResponse,
  type FieldExecutionJobDetail as FieldApprovalJobDetail,
} from './field-approval-contract';

const REPORT_SECTION_TYPES = new Set([
  'checklist',
  'measurement_table',
  'findings',
  'photos',
  'free_text',
  'customer_acknowledgement',
] as const);
const REPORT_SECTION_STATUSES = new Set(['pending', 'in_progress', 'completed'] as const);
const REPORT_SECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const REPORTABLE_INTERVENTION_STATUSES = new Set(['in_progress', 'pending_part', 'completed'] as const);
const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);

export type FieldReportSectionType =
  | 'checklist'
  | 'measurement_table'
  | 'findings'
  | 'photos'
  | 'free_text'
  | 'customer_acknowledgement';
export type FieldReportSectionStatus = 'pending' | 'in_progress' | 'completed';

export type FieldReportSection = {
  id: string;
  title: string;
  type: FieldReportSectionType;
  required: boolean;
  minEvidenceCount?: number;
  minMeasurementCount?: number;
};

export type FieldReportTemplateSnapshot = {
  id: string;
  name: string;
  serviceId: string;
  version: number;
  sections: FieldReportSection[];
};

export type FieldReportPhotoEvidence = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  interventionId: string;
  sectionId: string;
  kind: 'photo';
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  caption?: string;
  capturedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldInterventionReport = {
  interventionId: string;
  visitAssetId: string;
  assetId: string;
  serviceCatalogItemId: string;
  template: FieldReportTemplateSnapshot;
  sectionStatus: Record<string, FieldReportSectionStatus>;
  evidence: FieldReportPhotoEvidence[];
};

export type FieldReportPhotoOption = {
  interventionId: string;
  sectionIds: string[];
};

export type FieldReportJobDetail = FieldApprovalJobDetail & {
  interventionReports: FieldInterventionReport[];
  reportPhotoOptions: FieldReportPhotoOption[];
  canAddReportPhoto: boolean;
};

export type FieldAddReportPhotoEvidenceResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  evidence: FieldReportPhotoEvidence;
  workInterventionVersion: number;
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

function positiveSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function nonNegativeSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalNonNegativeSafeInteger(value: unknown) {
  return value === undefined || nonNegativeSafeInteger(value);
}

function uniqueStrings(value: unknown, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  if (!value.every(nonEmptyString)) return false;
  return value.length === new Set(value).size;
}

function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value)
    && value.every((action) => typeof action === 'string' && ALLOWED_ACTIONS.has(action));
}

function reportSectionValid(value: unknown): value is FieldReportSection {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && REPORT_SECTION_ID_PATTERN.test(item.id)
    && nonEmptyString(item.title)
    && nonEmptyString(item.type)
    && REPORT_SECTION_TYPES.has(item.type as FieldReportSectionType)
    && typeof item.required === 'boolean'
    && optionalNonNegativeSafeInteger(item.minEvidenceCount)
    && optionalNonNegativeSafeInteger(item.minMeasurementCount));
}

function reportTemplateValid(value: unknown): value is FieldReportTemplateSnapshot {
  const item = record(value);
  if (!item
    || !nonEmptyString(item.id)
    || !nonEmptyString(item.name)
    || !nonEmptyString(item.serviceId)
    || !positiveSafeInteger(item.version)
    || !Array.isArray(item.sections)
    || item.sections.length === 0
    || item.sections.length > 50
    || !item.sections.every(reportSectionValid)) return false;
  const ids = item.sections.map((section) => (section as FieldReportSection).id);
  return ids.length === new Set(ids).size;
}

function sectionStatusValid(value: unknown, template: FieldReportTemplateSnapshot): value is Record<string, FieldReportSectionStatus> {
  const item = record(value);
  if (!item) return false;
  const expectedIds = template.sections.map((section) => section.id);
  const actualIds = Object.keys(item);
  if (actualIds.length !== expectedIds.length || expectedIds.some((id) => !Object.prototype.hasOwnProperty.call(item, id))) return false;
  return expectedIds.every((id) => typeof item[id] === 'string' && REPORT_SECTION_STATUSES.has(item[id] as FieldReportSectionStatus));
}

function reportPhotoEvidenceValid(value: unknown): value is FieldReportPhotoEvidence {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && nonEmptyString(item.visitAssetId)
    && nonEmptyString(item.assetId)
    && nonEmptyString(item.interventionId)
    && nonEmptyString(item.sectionId)
    && item.kind === 'photo'
    && nonEmptyString(item.storagePath)
    && nonEmptyString(item.contentType)
    && item.contentType.toLowerCase().startsWith('image/')
    && positiveSafeInteger(item.sizeBytes)
    && optionalString(item.caption)
    && timestamp(item.capturedAt)
    && timestamp(item.createdAt)
    && nonEmptyString(item.createdBy)
    && timestamp(item.updatedAt)
    && nonEmptyString(item.updatedBy)
    && positiveSafeInteger(item.version));
}

function interventionReportValid(value: unknown): value is FieldInterventionReport {
  const item = record(value);
  if (!item
    || !nonEmptyString(item.interventionId)
    || !nonEmptyString(item.visitAssetId)
    || !nonEmptyString(item.assetId)
    || !nonEmptyString(item.serviceCatalogItemId)
    || !reportTemplateValid(item.template)
    || !sectionStatusValid(item.sectionStatus, item.template as FieldReportTemplateSnapshot)
    || !Array.isArray(item.evidence)
    || !item.evidence.every(reportPhotoEvidenceValid)) return false;
  return (item.template as FieldReportTemplateSnapshot).serviceId === item.serviceCatalogItemId;
}

function reportPhotoOptionsValid(value: unknown): value is FieldReportPhotoOption[] {
  if (!Array.isArray(value)) return false;
  const interventionIds = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !nonEmptyString(item.interventionId) || interventionIds.has(item.interventionId)) return false;
    interventionIds.add(item.interventionId);
    if (!uniqueStrings(item.sectionIds, { allowEmpty: false })) return false;
  }
  return true;
}

function reportRelationsValid(job: FieldReportJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const reportsByInterventionId = new Map<string, FieldInterventionReport>();

  if ((job.interventionReports.length > 0 || job.reportPhotoOptions.length > 0) && !visitId) return false;
  for (const report of job.interventionReports) {
    if (reportsByInterventionId.has(report.interventionId)) return false;
    const intervention = interventionById.get(report.interventionId);
    if (!intervention
      || !REPORTABLE_INTERVENTION_STATUSES.has(intervention.status as 'in_progress' | 'pending_part' | 'completed')
      || intervention.visitId !== visitId
      || intervention.visitAssetId !== report.visitAssetId
      || intervention.assetId !== report.assetId
      || intervention.serviceCatalogItemId !== report.serviceCatalogItemId
      || intervention.templateId !== report.template.id
      || intervention.templateVersion !== report.template.version) return false;

    const sectionById = new Map(report.template.sections.map((section) => [section.id, section]));
    const evidenceIds = new Set<string>();
    for (const evidence of report.evidence) {
      if (evidenceIds.has(evidence.id)) return false;
      evidenceIds.add(evidence.id);
      const section = sectionById.get(evidence.sectionId);
      if (!section
        || section.type !== 'photos'
        || evidence.visitId !== visitId
        || evidence.visitAssetId !== report.visitAssetId
        || evidence.assetId !== report.assetId
        || evidence.interventionId !== report.interventionId) return false;
    }
    reportsByInterventionId.set(report.interventionId, report);
  }

  for (const intervention of job.workInterventions) {
    const hasTemplateIdentity = Boolean(intervention.templateId || intervention.templateVersion !== undefined);
    const report = reportsByInterventionId.get(intervention.id);
    if (hasTemplateIdentity !== Boolean(report)) return false;
  }

  for (const option of job.reportPhotoOptions) {
    const report = reportsByInterventionId.get(option.interventionId);
    const intervention = interventionById.get(option.interventionId);
    if (!report || !intervention || intervention.status !== 'in_progress') return false;
    const photoSections = new Map(
      report.template.sections
        .filter((section) => section.type === 'photos')
        .map((section) => [section.id, section]),
    );
    if (option.sectionIds.some((sectionId) => !photoSections.has(sectionId) || report.sectionStatus[sectionId] === 'completed')) return false;
  }

  if (job.canAddReportPhoto !== (job.reportPhotoOptions.length > 0)) return false;
  if (job.canAddReportPhoto) {
    if (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('evidence.add')) return false;
  }
  return true;
}

export function parseFieldReportJobResponse(value: unknown): { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; job: FieldReportJobDetail } {
  const base = parseFieldApprovalJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  if (!rawJob
    || !Array.isArray(rawJob.interventionReports)
    || !rawJob.interventionReports.every(interventionReportValid)
    || !reportPhotoOptionsValid(rawJob.reportPhotoOptions)
    || typeof rawJob.canAddReportPhoto !== 'boolean') {
    throw new Error('Field Operations returned malformed report data. Refresh and try again.');
  }
  const job = base.job as FieldReportJobDetail;
  if (!reportRelationsValid(job)) {
    throw new Error('Field Operations returned inconsistent report data. Refresh and try again.');
  }
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldAddReportPhotoEvidenceResponse(value: unknown): FieldAddReportPhotoEvidenceResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !reportPhotoEvidenceValid(payload.evidence)
    || !positiveSafeInteger(payload.workInterventionVersion)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed report photo data. Refresh and try again.');
  }
  return payload as FieldAddReportPhotoEvidenceResponse;
}