'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  FIELD_EVIDENCE_COLLECTION,
  FIELD_EVIDENCE_STORAGE_VERSION,
} = require('./fieldOperationsEvidence');
const { projectStoredReportTemplateSnapshot, requireReportTemplateSection } = require('./fieldOperationsReportTemplates');
const {
  WORK_INTERVENTION_COLLECTION,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

const REPORT_VOICE_TARGET_TYPE = 'work_intervention_report_voice';
const REPORT_VOICE_EVIDENCE_KIND = 'voice_note';
const MAX_REPORT_VOICE_BYTES = 6 * 1024 * 1024;
const MAX_REPORT_VOICE_DURATION_SECONDS = 120;

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map(fieldSnapshotRecord);
}

function canonicalVoiceDuration(value) {
  const durationSeconds = Number(value);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_REPORT_VOICE_DURATION_SECONDS) {
    throw fieldError('invalid_report_voice_duration', 'Voice note duration must be greater than 0 and no longer than 120 seconds.', 409);
  }
  return Math.round(durationSeconds * 1000) / 1000;
}

function reportVoiceMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fieldError('report_voice_unavailable', 'The report voice note could not be verified.', 409);
  }
  const contentType = text(value.contentType, 120).toLowerCase();
  const sizeBytes = Number(value.sizeBytes ?? value.size);
  const supported = contentType.startsWith('audio/') || contentType === 'video/mp4';
  if (!supported) {
    throw fieldError('invalid_report_voice', 'Report voice evidence must be a supported audio recording.', 409);
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_REPORT_VOICE_BYTES) {
    throw fieldError('invalid_report_voice', 'Report voice evidence must be no larger than 6 MB.', 409);
  }
  return { contentType, sizeBytes };
}

function reportVoiceEvidenceId(interventionId, sectionId) {
  const normalizedInterventionId = text(interventionId, 180);
  const normalizedSectionId = text(sectionId, 120);
  if (!normalizedInterventionId || !normalizedSectionId) throw new Error('Intervention and section identity are required.');
  return deterministicId('EVID', `${normalizedInterventionId}:${normalizedSectionId}:voice_note`);
}

function validateReportVoiceStoragePath(storagePath, visitId, interventionId, sectionId) {
  const normalized = text(storagePath, 1000);
  const prefix = `field-evidence/${text(visitId, 180)}/interventions/${text(interventionId, 180)}/${text(sectionId, 120)}/voice/`;
  if (!normalized.startsWith(prefix) || normalized.includes('..')) {
    throw fieldError('invalid_report_voice_path', 'Report voice note does not belong to this Work Visit, intervention, or report section.', 409);
  }
  return normalized;
}

function projectReportVoiceEvidence(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_EVIDENCE_STORAGE_VERSION) {
    throw fieldError('invalid_field_evidence_schema', `Unsupported Field Evidence storage version: ${text(record?.fieldAuthorityVersion, 40) || 'missing'}.`, 409);
  }
  if (text(record?.targetType, 80) !== REPORT_VOICE_TARGET_TYPE || text(record?.evidenceKind, 80) !== REPORT_VOICE_EVIDENCE_KIND) {
    throw fieldError('invalid_report_voice_target', 'Persisted report voice evidence target is invalid.', 409);
  }
  const required = {
    id: text(record?.id, 180),
    visitId: text(record?.visitId, 180),
    workOrderId: text(record?.workOrderId, 180),
    customerId: text(record?.clientId || record?.customerId, 180),
    propertyId: text(record?.propertyId || record?.siteId, 180),
    visitAssetId: text(record?.visitAssetId, 180),
    assetId: text(record?.assetId, 180),
    interventionId: text(record?.interventionId, 180),
    sectionId: text(record?.sectionId, 120),
    storagePath: text(record?.storagePath, 1000),
  };
  if (Object.values(required).some((value) => !value)) {
    throw fieldError('report_voice_identity_conflict', 'Persisted report voice evidence identity is incomplete.', 409);
  }
  for (const [key, expected] of Object.entries(expectedContext)) {
    const normalizedExpected = text(expected, key === 'sectionId' ? 120 : 180);
    if (normalizedExpected && required[key] !== normalizedExpected) {
      throw fieldError('report_voice_identity_conflict', 'Persisted report voice evidence does not match its authorized context.', 409, { key });
    }
  }
  const media = reportVoiceMetadata({ contentType: record?.contentType, sizeBytes: record?.sizeBytes });
  const durationSeconds = canonicalVoiceDuration(record?.durationSeconds);
  const capturedAt = text(record?.capturedAt, 80);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    throw fieldError('invalid_field_evidence_timestamp', 'Persisted report voice capturedAt is invalid.', 409);
  }
  const version = Number(record?.version);
  if (!Number.isSafeInteger(version) || version !== 1) {
    throw fieldError('invalid_field_evidence_version', 'Persisted report voice version is invalid.', 409);
  }
  return {
    id: required.id,
    visitId: required.visitId,
    visitAssetId: required.visitAssetId,
    assetId: required.assetId,
    interventionId: required.interventionId,
    sectionId: required.sectionId,
    kind: REPORT_VOICE_EVIDENCE_KIND,
    storagePath: required.storagePath,
    contentType: media.contentType,
    sizeBytes: media.sizeBytes,
    durationSeconds,
    capturedAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    version: 1,
  };
}

async function loadReportVoiceEvidence(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const snapshot = await db.collection(FIELD_EVIDENCE_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return snapshotRecords(snapshot)
    .filter((record) => text(record?.targetType, 80) === REPORT_VOICE_TARGET_TYPE)
    .map((record) => projectReportVoiceEvidence(record, { ...expectedContext, visitId: normalizedVisitId }));
}

function reportVoiceNoteOptions(job, reports) {
  if (text(job?.fieldVisit?.status, 80) !== 'in_progress') return [];
  if (!Array.isArray(job?.allowedActions) || !job.allowedActions.includes('evidence.add')) return [];
  const interventionById = new Map((job?.workInterventions || []).map((intervention) => [intervention.id, intervention]));
  return reports.map((report) => {
    const intervention = interventionById.get(report.interventionId);
    if (!intervention || intervention.status !== 'in_progress') return null;
    const recorded = new Set((report.voiceNotes || []).map((item) => item.sectionId));
    const sectionIds = report.template.sections
      .filter((section) => section.type === 'voice_note')
      .filter((section) => report.sectionStatus?.[section.id] !== 'completed' && !recorded.has(section.id))
      .map((section) => section.id);
    return sectionIds.length ? { interventionId: report.interventionId, sectionIds } : null;
  }).filter(Boolean);
}

async function attachReportVoiceEvidenceToJob(db, job) {
  const reports = Array.isArray(job?.interventionReports)
    ? job.interventionReports.map((report) => ({ ...report, voiceNotes: [] }))
    : [];
  const visitId = text(job?.fieldVisit?.id, 180);
  if (visitId && reports.length) {
    const evidence = await loadReportVoiceEvidence(db, visitId, {
      workOrderId: text(job.workOrderId, 180),
      customerId: text(job.customerId, 180),
      propertyId: text(job.propertyId, 180),
    });
    const reportByInterventionId = new Map(reports.map((report) => [report.interventionId, report]));
    const keys = new Set();
    for (const item of evidence) {
      const report = reportByInterventionId.get(item.interventionId);
      if (!report) {
        throw fieldError('report_voice_identity_conflict', 'Persisted voice evidence references an intervention without a canonical report projection.', 409);
      }
      const section = report.template.sections.find((candidate) => candidate.id === item.sectionId);
      if (!section || section.type !== 'voice_note') {
        throw fieldError('report_voice_identity_conflict', 'Persisted voice evidence references an invalid frozen report section.', 409);
      }
      if (item.visitAssetId !== report.visitAssetId || item.assetId !== report.assetId) {
        throw fieldError('report_voice_identity_conflict', 'Persisted voice evidence does not match its Work Intervention equipment identity.', 409);
      }
      const key = `${item.interventionId}:${item.sectionId}`;
      if (keys.has(key)) {
        throw fieldError('report_voice_identity_conflict', 'More than one canonical voice note exists for the same report section.', 409);
      }
      keys.add(key);
      report.voiceNotes.push(item);
    }
    for (const report of reports) {
      report.voiceNotes.sort((left, right) => left.sectionId.localeCompare(right.sectionId));
      const recorded = new Set(report.voiceNotes.map((item) => item.sectionId));
      for (const section of report.template.sections.filter((candidate) => candidate.type === 'voice_note')) {
        const hasVoice = recorded.has(section.id);
        const completed = report.sectionStatus?.[section.id] === 'completed';
        if (hasVoice !== completed) {
          throw fieldError('report_voice_state_conflict', 'Voice evidence does not match the persisted report section completion state.', 409, {
            interventionId: report.interventionId,
            sectionId: section.id,
          });
        }
      }
    }
  }
  const options = reportVoiceNoteOptions(job, reports);
  return {
    ...job,
    interventionReports: reports,
    reportVoiceNoteOptions: options,
    canAddReportVoiceNote: options.length > 0,
  };
}

function reportVoiceAuditEvent({ requestId, evidence, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:report_voice_evidence:${evidence.id}`),
    type: 'report_voice_note_recorded',
    entityType: 'FieldEvidence',
    entityId: evidence.id,
    visitId: evidence.visitId,
    visitAssetId: evidence.visitAssetId,
    assetId: evidence.assetId,
    interventionId: evidence.interventionId,
    sectionId: evidence.sectionId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity?.uid, 180),
    performedByStaffId: text(identity?.staffId, 180) || undefined,
    performedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    after: {
      evidenceKind: evidence.kind,
      sectionId: evidence.sectionId,
      contentType: evidence.contentType,
      sizeBytes: evidence.sizeBytes,
      durationSeconds: evidence.durationSeconds,
    },
  };
}

function createAddReportVoiceEvidenceCommand({
  db,
  resolveAssignment,
  appendAuditInTransaction,
  verifyStoredAudio,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A transaction-capable Firestore db is required.');
  }
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');
  if (typeof verifyStoredAudio !== 'function') throw new Error('verifyStoredAudio is required.');

  return async function addReportVoiceEvidence({ identity, visitId, interventionId, sectionId, storagePath, durationSeconds, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedSectionId = text(sectionId, 120);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    if (!normalizedSectionId) throw fieldError('report_section_required', 'A report section id is required.', 400);
    const stable = stableRequestId(requestId);
    const duration = canonicalVoiceDuration(durationSeconds);
    const normalizedStoragePath = validateReportVoiceStoragePath(storagePath, normalizedVisitId, normalizedInterventionId, normalizedSectionId);

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'evidence.add',
        deniedMessage: 'This assignment cannot add report evidence to the visit.',
      });
      if (context.canonicalVisit.status !== 'in_progress') {
        throw fieldError('report_voice_not_allowed', 'Voice evidence can only be added while the physical visit is in progress.', 409);
      }
    });

    let storageMetadata;
    try {
      storageMetadata = await verifyStoredAudio(normalizedStoragePath);
    } catch (cause) {
      if (cause?.code === 'invalid_report_voice' || cause?.code === 'report_voice_unavailable') throw cause;
      const error = fieldError('report_voice_unavailable', 'The report voice note could not be verified.', 409);
      error.cause = cause;
      throw error;
    }
    const media = reportVoiceMetadata(storageMetadata);

    let result;
    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'evidence.add',
        deniedMessage: 'This assignment cannot add report evidence to the visit.',
      });
      if (context.canonicalVisit.status !== 'in_progress') {
        throw fieldError('report_voice_not_allowed', 'Voice evidence can only be added while the physical visit is in progress.', 409);
      }
      const expectedContext = {
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        customerId: context.customerId,
        propertyId: context.propertyId,
      };
      const interventionRef = db.collection(WORK_INTERVENTION_COLLECTION).doc(normalizedInterventionId);
      const interventionSnapshot = await transaction.get(interventionRef);
      if (!interventionSnapshot.exists) {
        throw fieldError('work_intervention_not_found', 'The selected Work Intervention is not available for this visit.', 404);
      }
      const storedIntervention = fieldSnapshotRecord(interventionSnapshot);
      const intervention = projectWorkIntervention(storedIntervention, expectedContext);
      if (intervention.status !== 'in_progress') {
        throw fieldError('report_voice_not_allowed', 'Voice evidence requires an in-progress Work Intervention.', 409);
      }
      const template = projectStoredReportTemplateSnapshot(storedIntervention.reportTemplateSnapshot, intervention.serviceCatalogItemId);
      if (!template) throw fieldError('report_template_not_available', 'This Work Intervention has no frozen report template.', 409);
      requireReportTemplateSection(template, normalizedSectionId, 'voice_note');

      const evidenceId = reportVoiceEvidenceId(normalizedInterventionId, normalizedSectionId);
      const evidenceRef = db.collection(FIELD_EVIDENCE_COLLECTION).doc(evidenceId);
      const existingSnapshot = await transaction.get(evidenceRef);
      const exactContext = {
        ...expectedContext,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
      };
      if (existingSnapshot.exists) {
        const stored = fieldSnapshotRecord(existingSnapshot);
        const existing = projectReportVoiceEvidence(stored, exactContext);
        const exactReplay = text(stored.requestId, 240) === stable
          && existing.storagePath === normalizedStoragePath
          && existing.durationSeconds === duration;
        if (!exactReplay) {
          throw fieldError('report_voice_already_recorded', 'This report section already has immutable voice evidence.', 409);
        }
        if (storedIntervention.reportSectionStatus?.[normalizedSectionId] !== 'completed') {
          throw fieldError('report_voice_state_conflict', 'Persisted voice evidence does not match report section completion state.', 409);
        }
        result = {
          success: true,
          replayed: true,
          evidence: existing,
          workInterventionVersion: intervention.version,
          allowedActions: context.allowedActions,
        };
        return;
      }

      if (storedIntervention.reportSectionStatus?.[normalizedSectionId] === 'completed') {
        throw fieldError('report_voice_state_conflict', 'Report section is completed without canonical voice evidence.', 409);
      }
      if (!Number.isSafeInteger(intervention.version) || intervention.version >= Number.MAX_SAFE_INTEGER) {
        throw fieldError('work_intervention_version_exhausted', 'Work Intervention version cannot be advanced safely.', 409);
      }
      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const evidenceRecord = fieldFirestoreData({
        id: evidenceId,
        fieldAuthorityVersion: FIELD_EVIDENCE_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
        evidenceKind: REPORT_VOICE_EVIDENCE_KIND,
        targetType: REPORT_VOICE_TARGET_TYPE,
        storagePath: normalizedStoragePath,
        contentType: media.contentType,
        sizeBytes: media.sizeBytes,
        durationSeconds: duration,
        requestId: stable,
        capturedAt: occurredAt,
        createdAt: occurredAt,
        createdByUserId: text(identity?.uid, 180),
        createdByStaffId: text(identity?.staffId, 180) || undefined,
        createdByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        version: 1,
      }, 'fieldEvidence');
      const evidence = projectReportVoiceEvidence(evidenceRecord, exactContext);
      const sectionStatus = { ...(storedIntervention.reportSectionStatus || {}) };
      sectionStatus[normalizedSectionId] = 'completed';
      const interventionPatch = fieldFirestoreData({
        reportSectionStatus: sectionStatus,
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: text(identity?.staffId, 180) || undefined,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: intervention.version + 1,
      }, 'workInterventionReportVoice');
      const event = reportVoiceAuditEvent({ requestId: stable, evidence, context, identity, occurredAt });

      transaction.create(evidenceRef, evidenceRecord);
      transaction.update(interventionRef, interventionPatch);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        evidence,
        workInterventionVersion: intervention.version + 1,
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

module.exports.MAX_REPORT_VOICE_BYTES = MAX_REPORT_VOICE_BYTES;
module.exports.MAX_REPORT_VOICE_DURATION_SECONDS = MAX_REPORT_VOICE_DURATION_SECONDS;
module.exports.REPORT_VOICE_EVIDENCE_KIND = REPORT_VOICE_EVIDENCE_KIND;
module.exports.REPORT_VOICE_TARGET_TYPE = REPORT_VOICE_TARGET_TYPE;
module.exports.attachReportVoiceEvidenceToJob = attachReportVoiceEvidenceToJob;
module.exports.canonicalVoiceDuration = canonicalVoiceDuration;
module.exports.createAddReportVoiceEvidenceCommand = createAddReportVoiceEvidenceCommand;
module.exports.loadReportVoiceEvidence = loadReportVoiceEvidence;
module.exports.projectReportVoiceEvidence = projectReportVoiceEvidence;
module.exports.reportVoiceAuditEvent = reportVoiceAuditEvent;
module.exports.reportVoiceEvidenceId = reportVoiceEvidenceId;
module.exports.reportVoiceMetadata = reportVoiceMetadata;
module.exports.reportVoiceNoteOptions = reportVoiceNoteOptions;
module.exports.validateReportVoiceStoragePath = validateReportVoiceStoragePath;
