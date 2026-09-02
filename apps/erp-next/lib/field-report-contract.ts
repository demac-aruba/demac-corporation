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
  'voice_note',
  'customer_acknowledgement',
] as const);
const REPORT_SECTION_STATUSES = new Set(['pending', 'in_progress', 'completed'] as const);
const REPORT_SECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const REPORTABLE_INTERVENTION_STATUSES = new Set(['in_progress', 'pending_part', 'completed'] as const);
const MEASUREMENT_MOMENTS = new Set(['before', 'during', 'after', 'diagnostic', 'general'] as const);
const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);

export type FieldReportSectionType =
  | 'checklist'
  | 'measurement_table'
  | 'findings'
  | 'photos'
  | 'free_text'
  | 'voice_note'
  | 'customer_acknowledgement';
export type FieldReportSectionStatus = 'pending' | 'in_progress' | 'completed';
export type FieldMeasurementMoment = 'before' | 'during' | 'after' | 'diagnostic' | 'general';

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

export type FieldReportMeasurement = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  interventionId: string;
  sectionId: string;
  metric: string;
  value: number | string;
  unit: string;
  moment: FieldMeasurementMoment;
  technicianStaffId: string;
  measuredAt: string;
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
  measurements: FieldReportMeasurement[];
};

export type FieldReportSectionOption = {
  interventionId: string;
  sectionIds: string[];
};

export type FieldReportPhotoOption = FieldReportSectionOption;
export type FieldReportMeasurementOption = FieldReportSectionOption;

export type FieldReportJobDetail = FieldApprovalJobDetail & {
  interventionReports: FieldInterventionReport[];
  reportPhotoOptions: FieldReportPhotoOption[];
  canAddReportPhoto: boolean;
  reportMeasurementOptions: FieldReportMeasurementOption[];
  canAddReportMeasurement: boolean;
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

export type FieldAddReportMeasurementResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  measurement: FieldReportMeasurement;
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

function finiteNumberOrNonEmptyString(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isFinite(value)) || nonEmptyString(value);
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

function reportMeasurementValid(value: unknown): value is FieldReportMeasurement {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && nonEmptyString(item.visitAssetId)
    && nonEmptyString(item.assetId)
    && nonEmptyString(item.interventionId)
    && nonEmptyString(item.sectionId)
    && nonEmptyString(item.metric)
    && finiteNumberOrNonEmptyString(item.value)
    && nonEmptyString(item.unit)
    && nonEmptyString(item.moment)
    && MEASUREMENT_MOMENTS.has(item.moment as FieldMeasurementMoment)
    && nonEmptyString(item.technicianStaffId)
    && timestamp(item.measuredAt)
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
    || !item.evidence.every(reportPhotoEvidenceValid)
    || !Array.isArray(item.measurements)
    || !item.measurements.every(reportMeasurementValid)) return false;
  return (item.template as FieldReportTemplateSnapshot).serviceId === item.serviceCatalogItemId;
}

function reportSectionOptionsValid(value: unknown): value is FieldReportSectionOption[] {
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

function reportOptionRelationsValid(
  options: FieldReportSectionOption[],
  reportsByInterventionId: Map<string, FieldInterventionReport>,
  interventionById: Map<string, FieldApprovalJobDetail['workInterventions'][number]>,
  sectionType: FieldReportSectionType,
) {
  for (const option of options) {
    const report = reportsByInterventionId.get(option.interventionId);
    const intervention = interventionById.get(option.interventionId);
    if (!report || !intervention || intervention.status !== 'in_progress') return false;
    const eligibleSections = new Map(
      report.template.sections
        .filter((section) => section.type === sectionType)
        .map((section) => [section.id, section]),
    );
    if (option.sectionIds.some((sectionId) => !eligibleSections.has(sectionId) || report.sectionStatus[sectionId] === 'completed')) return false;
  }
  return true;
}

function reportRelationsValid(job: FieldReportJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const reportsByInterventionId = new Map<string, FieldInterventionReport>();

  if ((job.interventionReports.length > 0 || job.reportPhotoOptions.length > 0 || job.reportMeasurementOptions.length > 0) && !visitId) return false;
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

    const measurementIds = new Set<string>();
    for (const measurement of report.measurements) {
      if (measurementIds.has(measurement.id)) return false;
      measurementIds.add(measurement.id);
      const section = sectionById.get(measurement.sectionId);
      if (!section
        || section.type !== 'measurement_table'
        || measurement.visitId !== visitId
        || measurement.visitAssetId !== report.visitAssetId
        || measurement.assetId !== report.assetId
        || measurement.interventionId !== report.interventionId) return false;
    }
    reportsByInterventionId.set(report.interventionId, report);
  }

  for (const intervention of job.workInterventions) {
    const hasTemplateIdentity = Boolean(intervention.templateId || intervention.templateVersion !== undefined);
    const report = reportsByInterventionId.get(intervention.id);
    if (hasTemplateIdentity !== Boolean(report)) return false;
  }

  if (!reportOptionRelationsValid(job.reportPhotoOptions, reportsByInterventionId, interventionById, 'photos')) return false;
  if (!reportOptionRelationsValid(job.reportMeasurementOptions, reportsByInterventionId, interventionById, 'measurement_table')) return false;

  if (job.canAddReportPhoto !== (job.reportPhotoOptions.length > 0)) return false;
  if (job.canAddReportPhoto) {
    if (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('evidence.add')) return false;
  }
  if (job.canAddReportMeasurement !== (job.reportMeasurementOptions.length > 0)) return false;
  if (job.canAddReportMeasurement) {
    if (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('measurement.add')) return false;
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
    || !reportSectionOptionsValid(rawJob.reportPhotoOptions)
    || typeof rawJob.canAddReportPhoto !== 'boolean'
    || !reportSectionOptionsValid(rawJob.reportMeasurementOptions)
    || typeof rawJob.canAddReportMeasurement !== 'boolean') {
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

export function parseFieldAddReportMeasurementResponse(value: unknown): FieldAddReportMeasurementResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !reportMeasurementValid(payload.measurement)
    || !positiveSafeInteger(payload.workInterventionVersion)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed report measurement data. Refresh and try again.');
  }
  return payload as FieldAddReportMeasurementResponse;
}
