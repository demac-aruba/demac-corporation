import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  type FieldAllowedAction,
} from './field-authority-contract';
import {
  parseFieldChecklistJobResponse,
  type FieldChecklistInterventionReport,
  type FieldChecklistJobDetail,
} from './field-checklist-contract';
import type { FieldReportSectionOption } from './field-report-contract';

const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);
const MAX_FREE_TEXT_LENGTH = 5000;

export type FieldReportFreeTextResponse = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  interventionId: string;
  sectionId: string;
  value: string;
  technicianStaffId: string;
  respondedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldFreeTextInterventionReport = FieldChecklistInterventionReport & {
  freeTextResponses: FieldReportFreeTextResponse[];
};

export type FieldReportFreeTextOption = FieldReportSectionOption;

export type FieldFreeTextJobDetail = Omit<FieldChecklistJobDetail, 'interventionReports'> & {
  interventionReports: FieldFreeTextInterventionReport[];
  reportFreeTextOptions: FieldReportFreeTextOption[];
  canEditReportFreeText: boolean;
};

export type FieldSetReportFreeTextResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  response: FieldReportFreeTextResponse;
  sectionCompleted: boolean;
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

function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value)
    && value.every((action) => typeof action === 'string' && ALLOWED_ACTIONS.has(action));
}

function freeTextResponseValid(value: unknown): value is FieldReportFreeTextResponse {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && nonEmptyString(item.visitAssetId)
    && nonEmptyString(item.assetId)
    && nonEmptyString(item.interventionId)
    && nonEmptyString(item.sectionId)
    && typeof item.value === 'string'
    && item.value.length <= MAX_FREE_TEXT_LENGTH
    && nonEmptyString(item.technicianStaffId)
    && timestamp(item.respondedAt)
    && timestamp(item.createdAt)
    && nonEmptyString(item.createdBy)
    && timestamp(item.updatedAt)
    && nonEmptyString(item.updatedBy)
    && positiveSafeInteger(item.version));
}

function optionsValid(value: unknown): value is FieldReportFreeTextOption[] {
  if (!Array.isArray(value)) return false;
  const interventionIds = new Set<string>();
  for (const candidate of value) {
    const option = record(candidate);
    if (!option || !nonEmptyString(option.interventionId) || interventionIds.has(option.interventionId)) return false;
    interventionIds.add(option.interventionId);
    if (!Array.isArray(option.sectionIds)
      || option.sectionIds.length === 0
      || !option.sectionIds.every(nonEmptyString)
      || option.sectionIds.length !== new Set(option.sectionIds).size) return false;
  }
  return true;
}

function relationsValid(job: FieldFreeTextJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  if ((job.interventionReports.some((report) => report.freeTextResponses.length > 0) || job.reportFreeTextOptions.length > 0) && !visitId) return false;

  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const reportByInterventionId = new Map(job.interventionReports.map((report) => [report.interventionId, report]));
  const responseIds = new Set<string>();

  for (const report of job.interventionReports) {
    const responseBySectionId = new Map<string, FieldReportFreeTextResponse>();
    const sectionById = new Map(report.template.sections.map((section) => [section.id, section]));
    for (const response of report.freeTextResponses) {
      if (responseIds.has(response.id) || responseBySectionId.has(response.sectionId)) return false;
      responseIds.add(response.id);
      responseBySectionId.set(response.sectionId, response);
      const section = sectionById.get(response.sectionId);
      if (!section
        || section.type !== 'free_text'
        || response.visitId !== visitId
        || response.visitAssetId !== report.visitAssetId
        || response.assetId !== report.assetId
        || response.interventionId !== report.interventionId) return false;
    }
    for (const section of report.template.sections.filter((candidate) => candidate.type === 'free_text')) {
      const response = responseBySectionId.get(section.id);
      const completed = Boolean(response && response.value.length > 0);
      if (completed !== (report.sectionStatus[section.id] === 'completed')) {
        if (completed || report.sectionStatus[section.id] === 'completed') return false;
      }
    }
  }

  for (const option of job.reportFreeTextOptions) {
    const report = reportByInterventionId.get(option.interventionId);
    const intervention = interventionById.get(option.interventionId);
    if (!report || !intervention || intervention.status !== 'in_progress') return false;
    const eligible = new Set(report.template.sections.filter((section) => section.type === 'free_text').map((section) => section.id));
    if (option.sectionIds.some((sectionId) => !eligible.has(sectionId))) return false;
  }

  if (job.canEditReportFreeText !== (job.reportFreeTextOptions.length > 0)) return false;
  if (job.canEditReportFreeText && (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('report.edit'))) return false;
  return true;
}

export function parseFieldFreeTextJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldFreeTextJobDetail;
} {
  const base = parseFieldChecklistJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  const rawReports = Array.isArray(rawJob?.interventionReports) ? rawJob.interventionReports : null;
  if (!rawJob
    || !rawReports
    || !rawReports.every((candidate) => {
      const report = record(candidate);
      return Boolean(report && Array.isArray(report.freeTextResponses) && report.freeTextResponses.every(freeTextResponseValid));
    })
    || !optionsValid(rawJob.reportFreeTextOptions)
    || typeof rawJob.canEditReportFreeText !== 'boolean') {
    throw new Error('Field Operations returned malformed free-text report data. Refresh and try again.');
  }
  const job = base.job as FieldFreeTextJobDetail;
  if (!relationsValid(job)) throw new Error('Field Operations returned inconsistent free-text report data. Refresh and try again.');
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldSetReportFreeTextResponse(value: unknown): FieldSetReportFreeTextResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !freeTextResponseValid(payload.response)
    || typeof payload.sectionCompleted !== 'boolean'
    || payload.sectionCompleted !== ((payload.response as FieldReportFreeTextResponse).value.length > 0)
    || !positiveSafeInteger(payload.workInterventionVersion)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed free-text mutation data. Refresh and try again.');
  }
  return payload as FieldSetReportFreeTextResponse;
}
