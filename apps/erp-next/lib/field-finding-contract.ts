import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  type FieldAllowedAction,
} from './field-authority-contract';
import {
  parseFieldReportJobResponse,
  type FieldInterventionReport,
  type FieldReportJobDetail,
  type FieldReportSectionOption,
} from './field-report-contract';

const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);

export type FieldReportFinding = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  interventionId: string;
  sectionId: string;
  summary: string;
  details: string;
  recommendation?: string;
  technicianStaffId: string;
  observedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldFindingInterventionReport = FieldInterventionReport & {
  findings: FieldReportFinding[];
};

export type FieldReportFindingOption = FieldReportSectionOption;

export type FieldFindingJobDetail = Omit<FieldReportJobDetail, 'interventionReports'> & {
  interventionReports: FieldFindingInterventionReport[];
  reportFindingOptions: FieldReportFindingOption[];
  canAddReportFinding: boolean;
};

export type FieldAddReportFindingResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  finding: FieldReportFinding;
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

function findingValid(value: unknown): value is FieldReportFinding {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && nonEmptyString(item.visitAssetId)
    && nonEmptyString(item.assetId)
    && nonEmptyString(item.interventionId)
    && nonEmptyString(item.sectionId)
    && nonEmptyString(item.summary)
    && item.summary.trim().length >= 3
    && nonEmptyString(item.details)
    && item.details.trim().length >= 3
    && optionalString(item.recommendation)
    && nonEmptyString(item.technicianStaffId)
    && timestamp(item.observedAt)
    && timestamp(item.createdAt)
    && nonEmptyString(item.createdBy)
    && timestamp(item.updatedAt)
    && nonEmptyString(item.updatedBy)
    && positiveSafeInteger(item.version));
}

function reportFindingOptionsValid(value: unknown): value is FieldReportFindingOption[] {
  if (!Array.isArray(value)) return false;
  const interventionIds = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !nonEmptyString(item.interventionId) || interventionIds.has(item.interventionId)) return false;
    interventionIds.add(item.interventionId);
    if (!Array.isArray(item.sectionIds) || item.sectionIds.length === 0 || !item.sectionIds.every(nonEmptyString)) return false;
    if (item.sectionIds.length !== new Set(item.sectionIds).size) return false;
  }
  return true;
}

function findingRelationsValid(job: FieldFindingJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  if ((job.interventionReports.some((report) => report.findings.length > 0) || job.reportFindingOptions.length > 0) && !visitId) return false;

  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const reportsByInterventionId = new Map(job.interventionReports.map((report) => [report.interventionId, report]));
  const findingIds = new Set<string>();

  for (const report of job.interventionReports) {
    const sectionById = new Map(report.template.sections.map((section) => [section.id, section]));
    for (const finding of report.findings) {
      if (findingIds.has(finding.id)) return false;
      findingIds.add(finding.id);
      const section = sectionById.get(finding.sectionId);
      if (!section
        || section.type !== 'findings'
        || finding.visitId !== visitId
        || finding.visitAssetId !== report.visitAssetId
        || finding.assetId !== report.assetId
        || finding.interventionId !== report.interventionId) return false;
    }
  }

  for (const option of job.reportFindingOptions) {
    const report = reportsByInterventionId.get(option.interventionId);
    const intervention = interventionById.get(option.interventionId);
    if (!report || !intervention || intervention.status !== 'in_progress') return false;
    const findingSectionIds = new Set(
      report.template.sections
        .filter((section) => section.type === 'findings')
        .map((section) => section.id),
    );
    if (option.sectionIds.some((sectionId) => !findingSectionIds.has(sectionId) || report.sectionStatus[sectionId] === 'completed')) return false;
  }

  if (job.canAddReportFinding !== (job.reportFindingOptions.length > 0)) return false;
  if (job.canAddReportFinding) {
    if (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('finding.add')) return false;
  }
  return true;
}

export function parseFieldFindingJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldFindingJobDetail;
} {
  const base = parseFieldReportJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  const rawReports = Array.isArray(rawJob?.interventionReports) ? rawJob.interventionReports : null;
  if (!rawJob
    || !rawReports
    || !rawReports.every((candidate) => {
      const report = record(candidate);
      return Boolean(report && Array.isArray(report.findings) && report.findings.every(findingValid));
    })
    || !reportFindingOptionsValid(rawJob.reportFindingOptions)
    || typeof rawJob.canAddReportFinding !== 'boolean') {
    throw new Error('Field Operations returned malformed finding data. Refresh and try again.');
  }
  const job = base.job as FieldFindingJobDetail;
  if (!findingRelationsValid(job)) {
    throw new Error('Field Operations returned inconsistent finding data. Refresh and try again.');
  }
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldAddReportFindingResponse(value: unknown): FieldAddReportFindingResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !findingValid(payload.finding)
    || !positiveSafeInteger(payload.workInterventionVersion)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed report finding data. Refresh and try again.');
  }
  return payload as FieldAddReportFindingResponse;
}
