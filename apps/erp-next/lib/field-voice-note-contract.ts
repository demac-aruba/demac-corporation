import {
  FIELD_ALLOWED_ACTIONS,
  FIELD_AUTHORITY_API_VERSION,
  type FieldAllowedAction,
} from './field-authority-contract';
import {
  parseFieldCustomerAcknowledgementJobResponse,
  type FieldCustomerAcknowledgementInterventionReport,
  type FieldCustomerAcknowledgementJobDetail,
} from './field-customer-acknowledgement-contract';
import type { FieldReportSectionOption } from './field-report-contract';

const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);
const MAX_REPORT_VOICE_BYTES = 6 * 1024 * 1024;
const MAX_REPORT_VOICE_DURATION_SECONDS = 120;

export type FieldReportVoiceNoteEvidence = {
  id: string;
  visitId: string;
  visitAssetId: string;
  assetId: string;
  interventionId: string;
  sectionId: string;
  kind: 'voice_note';
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number;
  capturedAt: string;
  createdAt: string;
  createdBy: string;
  version: 1;
};

export type FieldVoiceNoteInterventionReport = FieldCustomerAcknowledgementInterventionReport & {
  voiceNotes: FieldReportVoiceNoteEvidence[];
};

export type FieldReportVoiceNoteOption = FieldReportSectionOption;

export type FieldVoiceNoteJobDetail = Omit<FieldCustomerAcknowledgementJobDetail, 'interventionReports'> & {
  interventionReports: FieldVoiceNoteInterventionReport[];
  reportVoiceNoteOptions: FieldReportVoiceNoteOption[];
  canAddReportVoiceNote: boolean;
};

export type FieldAddReportVoiceNoteResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  evidence: FieldReportVoiceNoteEvidence;
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

function supportedVoiceContentType(value: unknown) {
  if (!nonEmptyString(value)) return false;
  const normalized = value.toLowerCase();
  return normalized.startsWith('audio/') || normalized === 'video/mp4';
}

function voiceNoteValid(value: unknown): value is FieldReportVoiceNoteEvidence {
  const item = record(value);
  return Boolean(item
    && nonEmptyString(item.id)
    && nonEmptyString(item.visitId)
    && nonEmptyString(item.visitAssetId)
    && nonEmptyString(item.assetId)
    && nonEmptyString(item.interventionId)
    && nonEmptyString(item.sectionId)
    && item.kind === 'voice_note'
    && nonEmptyString(item.storagePath)
    && supportedVoiceContentType(item.contentType)
    && positiveSafeInteger(item.sizeBytes)
    && (item.sizeBytes as number) <= MAX_REPORT_VOICE_BYTES
    && typeof item.durationSeconds === 'number'
    && Number.isFinite(item.durationSeconds)
    && item.durationSeconds > 0
    && item.durationSeconds <= MAX_REPORT_VOICE_DURATION_SECONDS
    && timestamp(item.capturedAt)
    && timestamp(item.createdAt)
    && nonEmptyString(item.createdBy)
    && item.version === 1);
}

function optionsValid(value: unknown): value is FieldReportVoiceNoteOption[] {
  if (!Array.isArray(value)) return false;
  const interventionIds = new Set<string>();
  for (const candidate of value) {
    const item = record(candidate);
    if (!item || !nonEmptyString(item.interventionId) || interventionIds.has(item.interventionId)) return false;
    interventionIds.add(item.interventionId);
    if (!Array.isArray(item.sectionIds)
      || item.sectionIds.length === 0
      || !item.sectionIds.every(nonEmptyString)
      || item.sectionIds.length !== new Set(item.sectionIds).size) return false;
  }
  return true;
}

function relationsValid(job: FieldVoiceNoteJobDetail) {
  const visitId = job.fieldVisit?.id ?? '';
  if ((job.interventionReports.some((report) => report.voiceNotes.length > 0) || job.reportVoiceNoteOptions.length > 0) && !visitId) return false;
  const interventionById = new Map(job.workInterventions.map((intervention) => [intervention.id, intervention]));
  const reportByInterventionId = new Map(job.interventionReports.map((report) => [report.interventionId, report]));
  const evidenceIds = new Set<string>();

  for (const report of job.interventionReports) {
    const noteBySection = new Map<string, FieldReportVoiceNoteEvidence>();
    const sectionById = new Map(report.template.sections.map((section) => [section.id, section]));
    for (const note of report.voiceNotes) {
      if (evidenceIds.has(note.id) || noteBySection.has(note.sectionId)) return false;
      evidenceIds.add(note.id);
      noteBySection.set(note.sectionId, note);
      const section = sectionById.get(note.sectionId);
      if (!section
        || section.type !== 'voice_note'
        || note.visitId !== visitId
        || note.visitAssetId !== report.visitAssetId
        || note.assetId !== report.assetId
        || note.interventionId !== report.interventionId) return false;
    }
    for (const section of report.template.sections.filter((candidate) => candidate.type === 'voice_note')) {
      const recorded = noteBySection.has(section.id);
      const completed = report.sectionStatus[section.id] === 'completed';
      if (recorded !== completed) return false;
    }
  }

  for (const option of job.reportVoiceNoteOptions) {
    const report = reportByInterventionId.get(option.interventionId);
    const intervention = interventionById.get(option.interventionId);
    if (!report || !intervention || intervention.status !== 'in_progress') return false;
    const recorded = new Set(report.voiceNotes.map((note) => note.sectionId));
    const eligible = new Set(
      report.template.sections
        .filter((section) => section.type === 'voice_note' && report.sectionStatus[section.id] !== 'completed')
        .map((section) => section.id),
    );
    if (option.sectionIds.some((sectionId) => !eligible.has(sectionId) || recorded.has(sectionId))) return false;
  }

  if (job.canAddReportVoiceNote !== (job.reportVoiceNoteOptions.length > 0)) return false;
  if (job.canAddReportVoiceNote && (job.fieldVisit?.status !== 'in_progress' || !job.allowedActions.includes('evidence.add'))) return false;
  return true;
}

export function parseFieldVoiceNoteJobResponse(value: unknown): {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  job: FieldVoiceNoteJobDetail;
} {
  const base = parseFieldCustomerAcknowledgementJobResponse(value);
  const payload = record(value);
  const rawJob = record(payload?.job);
  const rawReports = Array.isArray(rawJob?.interventionReports) ? rawJob.interventionReports : null;
  if (!rawJob
    || !rawReports
    || !rawReports.every((candidate) => {
      const report = record(candidate);
      return Boolean(report && Array.isArray(report.voiceNotes) && report.voiceNotes.every(voiceNoteValid));
    })
    || !optionsValid(rawJob.reportVoiceNoteOptions)
    || typeof rawJob.canAddReportVoiceNote !== 'boolean') {
    throw new Error('Field Operations returned malformed voice-note report data. Refresh and try again.');
  }
  const job = base.job as FieldVoiceNoteJobDetail;
  if (!relationsValid(job)) throw new Error('Field Operations returned inconsistent voice-note report data. Refresh and try again.');
  return { success: true, version: FIELD_AUTHORITY_API_VERSION, job };
}

export function parseFieldAddReportVoiceNoteResponse(value: unknown): FieldAddReportVoiceNoteResponse {
  const payload = record(value);
  if (!payload
    || payload.success !== true
    || payload.version !== FIELD_AUTHORITY_API_VERSION
    || typeof payload.replayed !== 'boolean'
    || !voiceNoteValid(payload.evidence)
    || !positiveSafeInteger(payload.workInterventionVersion)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed report voice-note data. Refresh and try again.');
  }
  return payload as FieldAddReportVoiceNoteResponse;
}

export { MAX_REPORT_VOICE_BYTES, MAX_REPORT_VOICE_DURATION_SECONDS };
