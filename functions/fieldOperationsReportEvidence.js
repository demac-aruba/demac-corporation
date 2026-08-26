'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  FIELD_EVIDENCE_COLLECTION,
  FIELD_EVIDENCE_STORAGE_VERSION,
  canonicalImageMetadata,
} = require('./fieldOperationsEvidence');
const { projectStoredReportTemplateSnapshot } = require('./fieldOperationsReportTemplates');
const {
  WORK_INTERVENTION_COLLECTION,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

const REPORT_EVIDENCE_TARGET_TYPE = 'work_intervention_report';
const REPORT_PHOTO_EVIDENCE_KIND = 'photo';

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function reportPhotoEvidenceId(interventionId, sectionId, requestId) {
  const normalizedInterventionId = text(interventionId, 180);
  const normalizedSectionId = text(sectionId, 120);
  const stable = text(requestId, 240);
  if (!normalizedInterventionId || !normalizedSectionId || !stable) throw new Error('Intervention, section and request identity are required.');
  return deterministicId('EVID', `${normalizedInterventionId}:${normalizedSectionId}:${stable}:photo`);
}

function reportSection(template, sectionId) {
  const normalizedSectionId = text(sectionId, 120);
  const section = template?.sections?.find((candidate) => candidate.id === normalizedSectionId);
  if (!section) {
    throw fieldError('report_section_not_available', 'The selected report section is not part of this Work Intervention template.', 409, {
      sectionId: normalizedSectionId,
    });
  }
  if (section.type !== 'photos') {
    throw fieldError('report_section_evidence_type_mismatch', 'The selected report section does not accept photo evidence.', 409, {
      sectionId: normalizedSectionId,
      sectionType: section.type,
    });
  }
  return section;
}

function validateReportPhotoStoragePath(storagePath, visitId, interventionId, sectionId) {
  const normalized = text(storagePath, 1000);
  const prefix = `field-evidence/${text(visitId, 180)}/interventions/${text(interventionId, 180)}/${text(sectionId, 120)}/`;
  if (!normalized.startsWith(prefix)) {
    throw fieldError('invalid_report_evidence_path', 'Report photo does not belong to this Work Visit, intervention, or report section.', 409);
  }
  return normalized;
}

function projectReportPhotoEvidence(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_EVIDENCE_STORAGE_VERSION) {
    throw fieldError('invalid_field_evidence_schema', `Unsupported Field Evidence storage version: ${text(record?.fieldAuthorityVersion, 40) || 'missing'}.`, 409);
  }
  if (text(record?.targetType, 80) !== REPORT_EVIDENCE_TARGET_TYPE || text(record?.evidenceKind, 80) !== REPORT_PHOTO_EVIDENCE_KIND) {
    throw fieldError('invalid_report_evidence_target', 'Persisted report photo evidence target is invalid.', 409);
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
    throw fieldError('report_evidence_identity_conflict', 'Persisted report photo evidence identity is incomplete.', 409);
  }
  for (const [key, expected] of Object.entries(expectedContext)) {
    const normalizedExpected = text(expected, key === 'sectionId' ? 120 : 180);
    if (normalizedExpected && required[key] !== normalizedExpected) {
      throw fieldError('report_evidence_identity_conflict', 'Persisted report photo evidence does not match its authorized context.', 409, { key });
    }
  }
  const image = canonicalImageMetadata({ contentType: record?.contentType, sizeBytes: record?.sizeBytes });
  const capturedAt = text(record?.capturedAt, 80);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    throw fieldError('invalid_field_evidence_timestamp', 'Persisted report photo capturedAt is invalid.', 409);
  }
  const version = Number(record?.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw fieldError('invalid_field_evidence_version', 'Persisted report photo version is invalid.', 409);
  }
  return {
    id: required.id,
    visitId: required.visitId,
    visitAssetId: required.visitAssetId,
    assetId: required.assetId,
    interventionId: required.interventionId,
    sectionId: required.sectionId,
    kind: REPORT_PHOTO_EVIDENCE_KIND,
    storagePath: required.storagePath,
    contentType: image.contentType,
    sizeBytes: image.sizeBytes,
    caption: text(record?.caption, 500) || undefined,
    capturedAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version,
  };
}

function reportPhotoAuditEvent({ requestId, evidence, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:report_photo_evidence:${evidence.id}`),
    type: 'report_photo_evidence_recorded',
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
    },
  };
}

function createAddReportPhotoEvidenceCommand({
  db,
  resolveAssignment,
  appendAuditInTransaction,
  verifyStoredImage,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A transaction-capable Firestore db is required.');
  }
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');
  if (typeof verifyStoredImage !== 'function') throw new Error('verifyStoredImage is required.');

  return async function addReportPhotoEvidence({ identity, visitId, interventionId, sectionId, storagePath, caption, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedSectionId = text(sectionId, 120);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    if (!normalizedSectionId) throw fieldError('report_section_required', 'A report section id is required.', 400);
    const stable = stableRequestId(requestId);
    const normalizedStoragePath = validateReportPhotoStoragePath(
      storagePath,
      normalizedVisitId,
      normalizedInterventionId,
      normalizedSectionId,
    );

    let authorizedContext;
    await db.runTransaction(async (transaction) => {
      authorizedContext = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'evidence.add',
        deniedMessage: 'This assignment cannot add report evidence to the visit.',
      });
      if (authorizedContext.canonicalVisit.status !== 'in_progress') {
        throw fieldError('report_evidence_not_allowed', 'Report evidence can only be added while the physical visit is in progress.', 409, {
          visitStatus: authorizedContext.canonicalVisit.status,
        });
      }
    });

    let storageMetadata;
    try {
      storageMetadata = await verifyStoredImage(normalizedStoragePath);
    } catch (cause) {
      if (cause?.code && String(cause.code).startsWith('invalid_')) throw cause;
      const error = fieldError('report_evidence_unavailable', 'The report photo could not be verified.', 409);
      error.cause = cause;
      throw error;
    }
    canonicalImageMetadata(storageMetadata);

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
        throw fieldError('report_evidence_not_allowed', 'Report evidence can only be added while the physical visit is in progress.', 409, {
          visitStatus: context.canonicalVisit.status,
        });
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
        throw fieldError('report_evidence_not_allowed', 'Report evidence requires an in-progress Work Intervention.', 409, {
          interventionStatus: intervention.status,
        });
      }
      const template = projectStoredReportTemplateSnapshot(storedIntervention.reportTemplateSnapshot, intervention.serviceCatalogItemId);
      if (!template) {
        throw fieldError('report_template_not_available', 'This Work Intervention has no frozen report template.', 409);
      }
      reportSection(template, normalizedSectionId);

      const evidenceId = reportPhotoEvidenceId(normalizedInterventionId, normalizedSectionId, stable);
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
        const existing = projectReportPhotoEvidence(fieldSnapshotRecord(existingSnapshot), exactContext);
        if (existing.storagePath !== normalizedStoragePath || (existing.caption || '') !== text(caption, 500)) {
          throw fieldError('report_evidence_request_conflict', 'This requestId was already used for different report photo input.', 409);
        }
        result = { success: true, replayed: true, evidence: existing, allowedActions: context.allowedActions };
        return;
      }

      if (!Number.isSafeInteger(intervention.version) || intervention.version >= Number.MAX_SAFE_INTEGER) {
        throw fieldError('work_intervention_version_exhausted', 'Work Intervention version cannot be advanced safely.', 409);
      }
      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const image = canonicalImageMetadata(storageMetadata);
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
        evidenceKind: REPORT_PHOTO_EVIDENCE_KIND,
        targetType: REPORT_EVIDENCE_TARGET_TYPE,
        storagePath: normalizedStoragePath,
        contentType: image.contentType,
        sizeBytes: image.sizeBytes,
        caption: text(caption, 500) || undefined,
        capturedAt: occurredAt,
        createdAt: occurredAt,
        createdByUserId: text(identity?.uid, 180),
        createdByStaffId: text(identity?.staffId, 180) || undefined,
        createdByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: text(identity?.staffId, 180) || undefined,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: 1,
      }, 'fieldEvidence');
      const evidence = projectReportPhotoEvidence(evidenceRecord, exactContext);
      const currentSectionStatus = storedIntervention.reportSectionStatus && typeof storedIntervention.reportSectionStatus === 'object'
        ? { ...storedIntervention.reportSectionStatus }
        : {};
      currentSectionStatus[normalizedSectionId] = 'in_progress';
      const interventionPatch = fieldFirestoreData({
        reportSectionStatus: currentSectionStatus,
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: text(identity?.staffId, 180) || undefined,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: intervention.version + 1,
      }, 'workInterventionReportEvidence');
      const event = reportPhotoAuditEvent({ requestId: stable, evidence, context, identity, occurredAt });

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

module.exports.REPORT_EVIDENCE_TARGET_TYPE = REPORT_EVIDENCE_TARGET_TYPE;
module.exports.REPORT_PHOTO_EVIDENCE_KIND = REPORT_PHOTO_EVIDENCE_KIND;
module.exports.createAddReportPhotoEvidenceCommand = createAddReportPhotoEvidenceCommand;
module.exports.projectReportPhotoEvidence = projectReportPhotoEvidence;
module.exports.reportPhotoEvidenceId = reportPhotoEvidenceId;
module.exports.reportPhotoAuditEvent = reportPhotoAuditEvent;
module.exports.reportSection = reportSection;
module.exports.validateReportPhotoStoragePath = validateReportPhotoStoragePath;