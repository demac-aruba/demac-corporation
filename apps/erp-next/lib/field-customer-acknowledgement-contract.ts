import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  type FieldAllowedAction,
} from './field-authority-contract';
import {
  parseFieldFreeTextJobResponse,
  type FieldFreeTextInterventionReport,
  type FieldFreeTextJobDetail,
} from './field-free-text-contract';
import type { FieldReportSectionOption } from './field-report-contract';

const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);

export type FieldCustomerAcknowledgementMethod = 'verbal';

export type FieldCustomerAcknowledgement = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  interventionId: string;
  sectionId: string;
  receiverName: string;
  method: FieldCustomerAcknowledgementMethod;
  note?: string;
  acknowledgedAt: string;
  recordedByStaffId: string;
  createdAt: string;
  createdBy: string;
  version: 1;
};

export type FieldCustomerAcknowledgementInterventionReport = FieldFreeTextInterventionReport & {
  customerAcknowledgements: FieldCustomerAcknowledgement[];
};

export type FieldCustomerAcknowledgementOption = FieldReportSectionOption;

export type FieldCustomerAcknowledgementJobDetail = Omit<FieldFreeTextJobDetail, 'interventionReports'> & {
  interventionReports: FieldCustomerAcknowledgementInterventionReport[];
  reportCustomerAcknowledgementOptions: FieldCustomerAcknowledgementOption[];
  canRecordCustomerAcknowledgement: boolean;
};

export type FieldRecordCustomerAcknowledgementResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  acknowledgement: FieldCustomerAcknowledgement;
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

function acknowledgementValid(value: unknown): value is FieldCustomerAcknowledgement {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && nonEmptyString(item.visitAssetId)
    && nonEmptyString(item.assetId)
    && nonEmptyString(item.interventionId)
    && nonEmptyString(item.sectionId)
    && nonEmptyString(item.receiverName)
    && item.method === 'verbal'
    && optionalString(item.note)
    && timestamp(item.acknowledgedAt)
    && nonEmptyString(item.recordedByStaffId)
    && timestamp(item.createdAt)
    && nonEmptyString(item.createdBy)
    && item.version === 1);
}

function optionsValid(value: unknown): value is FieldCustomerAcknowledgementOption[] {
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

function relationsValid(job: FieldCustomerAcknowledgementJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  if ((job.interventionReports.some((report) => report.customerAcknowledgements.length > 0)
    || job.reportCustomerAcknowledgementOptions.length > 0) && !visitId) return false;

  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const reportByInterventionId = new Map(job.interventionReports.map((report) => [report.interventionId, report]));
  const acknowledgementIds = new Set<string>();

  for (const report of job.interventionReports) {
    const bySectionId = new Map<string, FieldCustomerAcknowledgement>();
    const sectionById = new Map(report.template.sections.map((section) => [section.id, section]));
    for (const acknowledgement of report.customerAcknowledgements) {
      if (acknowledgementIds.has(acknowledgement.id) || bySectionId.has(acknowledgement.sectionId)) return false;
      acknowledgementIds.add(acknowledgement.id);
      bySectionId.set(acknowledgement.sectionId, acknowledgement);
      const section = sectionById.get(acknowledgement.sectionId);
      if (!section
        || section.type !== 'customer_acknowledgement'
        || acknowledgement.visitId !== visitId
        || acknowledgement.visitAssetId !== report.visitAssetId
        || acknowledgement.assetId !== report.assetId
        || acknowledgement.interventionId !== report.interventionId) return false;
    }
    for (const section of report.template.sections.filter((candidate) => candidate.type === 'customer_acknowledgement')) {
      const acknowledged = bySectionId.has(section.id);
      if (acknowledged !== (report.sectionStatus[section.id] === 'completed')) return false;
    }
  }

  for (const option of job.reportCustomerAcknowledgementOptions) {
    const report = reportByInterventionId.get(option.interventionId);
    const intervention = interventionById.get(option.interventionId);
    if (!report || !intervention || intervention.status !== 'in_progress') return false;
    const eligible = new Set(
      report.template.sections
        .filter((section) => section.type === 'customer_acknowledgement' && report.sectionStatus[section.id] !== 'completed')
        .map((section) => section.id),
    );
    if (option.sectionIds.some((sectionId) => !eligible.has(sectionId))) return false;
  }

  if (job.canRecordCustomerAcknowledgement !== (job.reportCustomerAcknowledgementOptions.length > 0)) return false;
  if (job.canRecordCustomerAcknowledgement
    && (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('execute'))) return false;
  return true;
}

export function parseFieldCustomerAcknowledgementJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldCustomerAcknowledgementJobDetail;
} {
  const base = parseFieldFreeTextJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  const rawReports = Array.isArray(rawJob?.interventionReports) ? rawJob.interventionReports : null;
  if (!rawJob
    || !rawReports
    || !rawReports.every((candidate) => {
      const report = record(candidate);
      return Boolean(report
        && Array.isArray(report.customerAcknowledgements)
        && report.customerAcknowledgements.every(acknowledgementValid));
    })
    || !optionsValid(rawJob.reportCustomerAcknowledgementOptions)
    || typeof rawJob.canRecordCustomerAcknowledgement !== 'boolean') {
    throw new Error('Field Operations returned malformed customer acknowledgement data. Refresh and try again.');
  }
  const job = base.job as FieldCustomerAcknowledgementJobDetail;
  if (!relationsValid(job)) {
    throw new Error('Field Operations returned inconsistent customer acknowledgement data. Refresh and try again.');
  }
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldRecordCustomerAcknowledgementResponse(value: unknown): FieldRecordCustomerAcknowledgementResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !acknowledgementValid(payload.acknowledgement)
    || !positiveSafeInteger(payload.workInterventionVersion)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed customer acknowledgement mutation data. Refresh and try again.');
  }
  return payload as FieldRecordCustomerAcknowledgementResponse;
}
