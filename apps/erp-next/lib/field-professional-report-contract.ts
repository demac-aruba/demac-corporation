import { FIELD_AUTHORITY_API_VERSION } from './field-authority-contract';
import {
  parseFieldVoiceNoteJobResponse,
  type FieldVoiceNoteInterventionReport,
  type FieldVoiceNoteJobDetail,
} from './field-voice-note-contract';
import type { FieldReportSectionStatus, FieldReportSectionType } from './field-report-contract';

const PROFESSIONAL_REPORT_STATUSES = new Set([
  'in_progress',
  'incomplete_report',
  'partial',
  'field_complete',
] as const);
const TERMINAL_INTERVENTION_STATUSES = new Set(['completed', 'not_performed', 'declined', 'cancelled']);

export type FieldRequiredReportSectionBlocker = {
  id: string;
  title: string;
  type: FieldReportSectionType;
  status: FieldReportSectionStatus;
};

export type FieldReportCompletion = {
  requiredSectionCount: number;
  completedRequiredSectionCount: number;
  incompleteRequiredSections: FieldRequiredReportSectionBlocker[];
  complete: boolean;
};

export type FieldProfessionalReportInterventionReport = FieldVoiceNoteInterventionReport & {
  completion: FieldReportCompletion;
};

export type FieldProfessionalReportStatus = 'in_progress' | 'incomplete_report' | 'partial' | 'field_complete';

export type FieldProfessionalReportMissingSection = {
  interventionId: string;
  sectionId: string;
  title: string;
  type: FieldReportSectionType;
  status: FieldReportSectionStatus;
};

export type FieldProfessionalReportPreview = {
  version: 1;
  source: 'canonical_field_truth';
  visitId: string;
  workOrderId: string;
  customerId: string;
  propertyId: string;
  status: FieldProfessionalReportStatus;
  plannedQuantity: number;
  actualAssetCount: number;
  interventionCount: number;
  completedInterventionCount: number;
  pendingPartInterventionCount: number;
  notPerformedInterventionCount: number;
  activeInterventionCount: number;
  requiredSectionCount: number;
  completedRequiredSectionCount: number;
  incompleteRequiredSections: FieldProfessionalReportMissingSection[];
};

export type FieldProfessionalReportJobDetail = Omit<FieldVoiceNoteJobDetail, 'interventionReports'> & {
  interventionReports: FieldProfessionalReportInterventionReport[];
  professionalReportPreview: FieldProfessionalReportPreview | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function completionValid(value: unknown, report: FieldVoiceNoteInterventionReport): value is FieldReportCompletion {
  const item = record(value);
  if (!item
    || !nonNegativeSafeInteger(item.requiredSectionCount)
    || !nonNegativeSafeInteger(item.completedRequiredSectionCount)
    || (item.completedRequiredSectionCount as number) > (item.requiredSectionCount as number)
    || !Array.isArray(item.incompleteRequiredSections)
    || typeof item.complete !== 'boolean') return false;
  const blockers = item.incompleteRequiredSections as unknown[];

  const requiredSections = report.template.sections.filter((section) => section.required);
  const expectedIncomplete = requiredSections.filter((section) => report.sectionStatus[section.id] !== 'completed');
  if (item.requiredSectionCount !== requiredSections.length
    || item.completedRequiredSectionCount !== requiredSections.length - expectedIncomplete.length
    || item.complete !== (expectedIncomplete.length === 0)
    || blockers.length !== expectedIncomplete.length) return false;

  return expectedIncomplete.every((section, index) => {
    const blocker = record(blockers[index]);
    return Boolean(blocker
      && blocker.id === section.id
      && blocker.title === section.title
      && blocker.type === section.type
      && blocker.status === report.sectionStatus[section.id]);
  });
}

function expectedPreviewStatus(job: FieldProfessionalReportJobDetail): FieldProfessionalReportStatus {
  if (job.workInterventions.some((intervention) => intervention.status === 'pending_part')) return 'partial';
  if (job.interventionReports.some((report) => !report.completion.complete)) return 'incomplete_report';
  if (job.workInterventions.length > 0
    && job.workInterventions.every((intervention) => TERMINAL_INTERVENTION_STATUSES.has(intervention.status))) return 'field_complete';
  return 'in_progress';
}

function previewValid(value: unknown, job: FieldProfessionalReportJobDetail): value is FieldProfessionalReportPreview | null {
  if (!job.fieldVisit) return value === null;
  const item = record(value);
  if (!item
    || item.version !== 1
    || item.source !== 'canonical_field_truth'
    || item.visitId !== job.fieldVisit.id
    || item.workOrderId !== job.workOrderId
    || item.customerId !== job.customerId
    || item.propertyId !== job.propertyId
    || !nonEmptyString(item.status)
    || !PROFESSIONAL_REPORT_STATUSES.has(item.status as FieldProfessionalReportStatus)
    || !Array.isArray(item.incompleteRequiredSections)) return false;
  const missingSections = item.incompleteRequiredSections as unknown[];

  const plannedQuantity = job.plannedWork.reduce((total, line) => total + Math.max(0, line.quantity), 0);
  const requiredSectionCount = job.interventionReports.reduce((total, report) => total + report.completion.requiredSectionCount, 0);
  const completedRequiredSectionCount = job.interventionReports.reduce((total, report) => total + report.completion.completedRequiredSectionCount, 0);
  const expectedMissing = job.interventionReports.flatMap((report) => report.completion.incompleteRequiredSections.map((section) => ({
    interventionId: report.interventionId,
    sectionId: section.id,
    title: section.title,
    type: section.type,
    status: section.status,
  })));
  if (item.status !== expectedPreviewStatus(job)
    || item.plannedQuantity !== plannedQuantity
    || item.actualAssetCount !== job.visitAssets.length
    || item.interventionCount !== job.workInterventions.length
    || item.completedInterventionCount !== job.workInterventions.filter((entry) => entry.status === 'completed').length
    || item.pendingPartInterventionCount !== job.workInterventions.filter((entry) => entry.status === 'pending_part').length
    || item.notPerformedInterventionCount !== job.workInterventions.filter((entry) => entry.status === 'not_performed').length
    || item.activeInterventionCount !== job.workInterventions.filter((entry) => ['planned', 'confirmed', 'in_progress', 'pending_authorization'].includes(entry.status)).length
    || item.requiredSectionCount !== requiredSectionCount
    || item.completedRequiredSectionCount !== completedRequiredSectionCount
    || missingSections.length !== expectedMissing.length) return false;

  return expectedMissing.every((expected, index) => {
    const actual = record(missingSections[index]);
    return Boolean(actual
      && actual.interventionId === expected.interventionId
      && actual.sectionId === expected.sectionId
      && actual.title === expected.title
      && actual.type === expected.type
      && actual.status === expected.status);
  });
}

export function parseFieldProfessionalReportJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldProfessionalReportJobDetail;
} {
  const base = parseFieldVoiceNoteJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  const rawReports = Array.isArray(rawJob?.interventionReports) ? rawJob.interventionReports : null;
  if (!rawJob || !rawReports || rawReports.length !== base.job.interventionReports.length) {
    throw new Error('Field Operations returned malformed Professional Report data. Refresh and try again.');
  }

  const reports: FieldProfessionalReportInterventionReport[] = base.job.interventionReports.map((report, index) => {
    const rawReport = record(rawReports[index]);
    if (!rawReport || rawReport.interventionId !== report.interventionId || !completionValid(rawReport.completion, report)) {
      throw new Error('Field Operations returned malformed report completion data. Refresh and try again.');
    }
    const completion = rawReport.completion as FieldReportCompletion;
    const intervention = base.job.workInterventions.find((candidate) => candidate.id === report.interventionId);
    if (intervention?.status === 'completed' && !completion.complete) {
      throw new Error('Field Operations returned contradictory completed report data. Refresh and try again.');
    }
    return { ...report, completion };
  });

  const job = { ...base.job, interventionReports: reports } as FieldProfessionalReportJobDetail;
  if (!Object.prototype.hasOwnProperty.call(rawJob, 'professionalReportPreview')
    || !previewValid(rawJob.professionalReportPreview, job)) {
    throw new Error('Field Operations returned inconsistent Professional Report preview data. Refresh and try again.');
  }
  job.professionalReportPreview = rawJob.professionalReportPreview as FieldProfessionalReportPreview | null;
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}