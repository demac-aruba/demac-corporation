import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  type FieldAllowedAction,
} from './field-authority-contract';
import {
  parseFieldFindingJobResponse,
  type FieldFindingInterventionReport,
  type FieldFindingJobDetail,
} from './field-finding-contract';
import type {
  FieldReportSection,
  FieldReportSectionOption,
  FieldReportTemplateSnapshot,
} from './field-report-contract';

const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);
const CHECKLIST_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export type FieldReportChecklistItem = {
  id: string;
  label: string;
};

export type FieldChecklistReportSection = FieldReportSection & {
  checklistItems?: FieldReportChecklistItem[];
};

export type FieldChecklistReportTemplateSnapshot = Omit<FieldReportTemplateSnapshot, 'sections'> & {
  sections: FieldChecklistReportSection[];
};

export type FieldReportChecklistResponse = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  interventionId: string;
  sectionId: string;
  itemId: string;
  checked: boolean;
  technicianStaffId: string;
  respondedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldChecklistInterventionReport = Omit<FieldFindingInterventionReport, 'template'> & {
  template: FieldChecklistReportTemplateSnapshot;
  checklistResponses: FieldReportChecklistResponse[];
};

export type FieldReportChecklistOption = FieldReportSectionOption;

export type FieldChecklistJobDetail = Omit<FieldFindingJobDetail, 'interventionReports'> & {
  interventionReports: FieldChecklistInterventionReport[];
  reportChecklistOptions: FieldReportChecklistOption[];
  canEditReportChecklist: boolean;
};

export type FieldSetReportChecklistItemResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  response: FieldReportChecklistResponse;
  sectionCompleted?: boolean;
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

function optionalBoolean(value: unknown) {
  return value === undefined || typeof value === 'boolean';
}

function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value)
    && value.every((action) => typeof action === 'string' && ALLOWED_ACTIONS.has(action));
}

function checklistItemValid(value: unknown): value is FieldReportChecklistItem {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && CHECKLIST_ITEM_ID_PATTERN.test(item.id)
    && nonEmptyString(item.label));
}

function checklistTemplateSectionsValid(value: unknown) {
  if (!Array.isArray(value)) return false;
  for (const candidate of value) {
    const section = record(candidate);
    if (!section || !nonEmptyString(section.type)) return false;
    if (section.type === 'checklist') {
      if (!Array.isArray(section.checklistItems)
        || section.checklistItems.length === 0
        || section.checklistItems.length > 100
        || !section.checklistItems.every(checklistItemValid)) return false;
      const ids = section.checklistItems.map((item) => (item as FieldReportChecklistItem).id);
      if (ids.length !== new Set(ids).size) return false;
    } else if (section.checklistItems !== undefined) {
      return false;
    }
  }
  return true;
}

function checklistResponseValid(value: unknown): value is FieldReportChecklistResponse {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && nonEmptyString(item.visitAssetId)
    && nonEmptyString(item.assetId)
    && nonEmptyString(item.interventionId)
    && nonEmptyString(item.sectionId)
    && nonEmptyString(item.itemId)
    && typeof item.checked === 'boolean'
    && nonEmptyString(item.technicianStaffId)
    && timestamp(item.respondedAt)
    && timestamp(item.createdAt)
    && nonEmptyString(item.createdBy)
    && timestamp(item.updatedAt)
    && nonEmptyString(item.updatedBy)
    && positiveSafeInteger(item.version));
}

function reportChecklistOptionsValid(value: unknown): value is FieldReportChecklistOption[] {
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

function checklistRelationsValid(job: FieldChecklistJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  if ((job.interventionReports.some((report) => report.checklistResponses.length > 0) || job.reportChecklistOptions.length > 0) && !visitId) return false;

  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const reportsByInterventionId = new Map(job.interventionReports.map((report) => [report.interventionId, report]));
  const responseIds = new Set<string>();
  const responseKeys = new Set<string>();

  for (const report of job.interventionReports) {
    const sectionById = new Map(report.template.sections.map((section) => [section.id, section]));
    const checkedBySectionAndItem = new Map<string, boolean>();
    for (const response of report.checklistResponses) {
      const key = `${response.sectionId}:${response.itemId}`;
      if (responseIds.has(response.id) || responseKeys.has(key)) return false;
      responseIds.add(response.id);
      responseKeys.add(key);
      const section = sectionById.get(response.sectionId);
      const item = section?.type === 'checklist'
        ? section.checklistItems?.find((candidate) => candidate.id === response.itemId)
        : undefined;
      if (!section
        || section.type !== 'checklist'
        || !item
        || response.visitId !== visitId
        || response.visitAssetId !== report.visitAssetId
        || response.assetId !== report.assetId
        || response.interventionId !== report.interventionId) return false;
      checkedBySectionAndItem.set(key, response.checked);
    }

    for (const section of report.template.sections.filter((candidate) => candidate.type === 'checklist')) {
      const items = section.checklistItems ?? [];
      if (items.length === 0) return false;
      const completed = items.every((item) => checkedBySectionAndItem.get(`${section.id}:${item.id}`) === true);
      if (completed !== (report.sectionStatus[section.id] === 'completed')) return false;
    }
  }

  for (const option of job.reportChecklistOptions) {
    const report = reportsByInterventionId.get(option.interventionId);
    const intervention = interventionById.get(option.interventionId);
    if (!report || !intervention || intervention.status !== 'in_progress') return false;
    const checklistSectionIds = new Set(
      report.template.sections
        .filter((section) => section.type === 'checklist')
        .map((section) => section.id),
    );
    if (option.sectionIds.some((sectionId) => !checklistSectionIds.has(sectionId))) return false;
  }

  if (job.canEditReportChecklist !== (job.reportChecklistOptions.length > 0)) return false;
  if (job.canEditReportChecklist) {
    if (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('report.edit')) return false;
  }
  return true;
}

export function parseFieldChecklistJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldChecklistJobDetail;
} {
  const base = parseFieldFindingJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  const rawReports = Array.isArray(rawJob?.interventionReports) ? rawJob.interventionReports : null;
  if (!rawJob
    || !rawReports
    || !rawReports.every((candidate) => {
      const report = record(candidate);
      const template = record(report?.template);
      return Boolean(report
        && template
        && checklistTemplateSectionsValid(template.sections)
        && Array.isArray(report.checklistResponses)
        && report.checklistResponses.every(checklistResponseValid));
    })
    || !reportChecklistOptionsValid(rawJob.reportChecklistOptions)
    || typeof rawJob.canEditReportChecklist !== 'boolean') {
    throw new Error('Field Operations returned malformed checklist data. Refresh and try again.');
  }
  const job = base.job as FieldChecklistJobDetail;
  if (!checklistRelationsValid(job)) {
    throw new Error('Field Operations returned inconsistent checklist data. Refresh and try again.');
  }
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldSetReportChecklistItemResponse(value: unknown): FieldSetReportChecklistItemResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !checklistResponseValid(payload.response)
    || !optionalBoolean(payload.sectionCompleted)
    || !positiveSafeInteger(payload.workInterventionVersion)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed checklist response data. Refresh and try again.');
  }
  if (payload.replayed === false && typeof payload.sectionCompleted !== 'boolean') {
    throw new Error('Field Operations returned incomplete checklist completion data. Refresh and try again.');
  }
  return payload as FieldSetReportChecklistItemResponse;
}