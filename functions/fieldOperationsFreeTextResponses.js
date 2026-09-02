'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  projectStoredReportTemplateSnapshot,
  requireReportTemplateSection,
} = require('./fieldOperationsReportTemplates');
const {
  WORK_INTERVENTION_COLLECTION,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

const FIELD_FREE_TEXT_RESPONSE_STORAGE_VERSION = 1;
const FIELD_FREE_TEXT_RESPONSE_COLLECTION = 'fieldFreeTextResponses';
const FIELD_FREE_TEXT_MAX_LENGTH = 5000;

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function freeTextResponseId(interventionId, sectionId) {
  const intervention = text(interventionId, 180);
  const section = text(sectionId, 120);
  if (!intervention || !section) throw new Error('Free-text response identity is required.');
  return deterministicId('FTXT', `${intervention}:${section}`);
}

function projectFieldFreeTextResponse(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_FREE_TEXT_RESPONSE_STORAGE_VERSION) {
    throw fieldError('invalid_field_free_text_response_schema', 'Persisted free-text response storage version is invalid.', 409);
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
  };
  if (Object.values(required).some((value) => !value)) {
    throw fieldError('field_free_text_response_identity_conflict', 'Persisted free-text response identity is incomplete.', 409);
  }
  for (const [key, expected] of Object.entries(expectedContext)) {
    const limit = key === 'sectionId' ? 120 : 180;
    const normalizedExpected = text(expected, limit);
    if (normalizedExpected && required[key] !== normalizedExpected) {
      throw fieldError('field_free_text_response_identity_conflict', 'Persisted free-text response does not match its authorized context.', 409, { key });
    }
  }
  if (typeof record?.value !== 'string' || record.value.length > FIELD_FREE_TEXT_MAX_LENGTH) {
    throw fieldError('invalid_field_free_text_response', 'Persisted free-text report value is invalid.', 409);
  }
  const technicianStaffId = text(record?.technicianStaffId, 180);
  const respondedAt = text(record?.respondedAt, 80);
  const lastRequestId = text(record?.lastRequestId, 240);
  const version = Number(record?.version);
  if (!technicianStaffId || !respondedAt || Number.isNaN(Date.parse(respondedAt)) || lastRequestId.length < 8) {
    throw fieldError('invalid_field_free_text_response', 'Persisted free-text response metadata is invalid.', 409);
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw fieldError('invalid_field_free_text_response_version', 'Persisted free-text response version is invalid.', 409);
  }
  return {
    id: required.id,
    visitId: required.visitId,
    visitAssetId: required.visitAssetId,
    assetId: required.assetId,
    interventionId: required.interventionId,
    sectionId: required.sectionId,
    value: record.value,
    technicianStaffId,
    respondedAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version,
  };
}

function freeTextAuditEvent({ requestId, response, context, identity, occurredAt, previousValue }) {
  return {
    id: deterministicId('FE', `${requestId}:report_free_text_changed:${response.id}`),
    type: 'report_free_text_changed',
    entityType: 'FieldFreeTextResponse',
    entityId: response.id,
    visitId: response.visitId,
    visitAssetId: response.visitAssetId,
    assetId: response.assetId,
    interventionId: response.interventionId,
    sectionId: response.sectionId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity?.uid, 180),
    performedByStaffId: text(identity?.staffId, 180) || undefined,
    performedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    before: { value: previousValue ?? null },
    after: { value: response.value },
  };
}

function createSetFieldFreeTextResponseCommand({
  db,
  resolveAssignment,
  appendAuditInTransaction,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A transaction-capable Firestore db is required.');
  }
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function setFieldFreeTextResponse({
    identity,
    visitId,
    interventionId,
    sectionId,
    value,
    expectedVersion,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedSectionId = text(sectionId, 120);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    if (!normalizedSectionId) throw fieldError('report_section_required', 'A report section id is required.', 400);
    if (typeof value !== 'string') throw fieldError('report_free_text_value_required', 'Free-text report value must be a string.', 400);
    if (value.length > FIELD_FREE_TEXT_MAX_LENGTH) {
      throw fieldError('report_free_text_too_long', `Free-text report value cannot exceed ${FIELD_FREE_TEXT_MAX_LENGTH} characters.`, 400);
    }
    const normalizedValue = value.trim();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw fieldError('expected_version_required', 'Free-text expectedVersion must be a non-negative safe integer.', 400);
    }
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'report.edit',
        deniedMessage: 'This assignment cannot edit technical report notes.',
      });
      if (context.canonicalVisit.status !== 'in_progress') {
        throw fieldError('field_free_text_not_allowed', 'Free-text report sections can only be edited while the physical visit is in progress.', 409, {
          visitStatus: context.canonicalVisit.status,
        });
      }
      const staffId = text(identity?.staffId, 180);
      if (!staffId) throw fieldError('technician_staff_required', 'Free-text report editing requires a DEMAC staff identity.', 403);
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
        throw fieldError('field_free_text_not_allowed', 'Free-text report editing requires an in-progress Work Intervention.', 409, {
          interventionStatus: intervention.status,
        });
      }
      const template = projectStoredReportTemplateSnapshot(storedIntervention.reportTemplateSnapshot, intervention.serviceCatalogItemId);
      if (!template) throw fieldError('report_template_not_available', 'This Work Intervention has no frozen report template.', 409);
      requireReportTemplateSection(template, normalizedSectionId, 'free_text');

      const responseId = freeTextResponseId(normalizedInterventionId, normalizedSectionId);
      const responseRef = db.collection(FIELD_FREE_TEXT_RESPONSE_COLLECTION).doc(responseId);
      const exactContext = {
        ...expectedContext,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
      };
      const responseSnapshot = await transaction.get(responseRef);
      const existing = responseSnapshot.exists
        ? projectFieldFreeTextResponse(fieldSnapshotRecord(responseSnapshot), exactContext)
        : null;
      const storedLastRequestId = responseSnapshot.exists ? text(responseSnapshot.data()?.lastRequestId, 240) : '';
      if (existing && storedLastRequestId === stable) {
        if (existing.value !== normalizedValue) {
          throw fieldError('field_free_text_request_conflict', 'This requestId was already used for a different free-text value.', 409);
        }
        result = {
          success: true,
          replayed: true,
          response: existing,
          sectionCompleted: existing.value.length > 0,
          workInterventionVersion: intervention.version,
          allowedActions: context.allowedActions,
        };
        return;
      }
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        throw fieldError('version_conflict', 'This report note changed on another device. Refresh before trying again.', 409, {
          expectedVersion,
          actualVersion: currentVersion,
        });
      }
      if (!Number.isSafeInteger(intervention.version) || intervention.version >= Number.MAX_SAFE_INTEGER) {
        throw fieldError('work_intervention_version_exhausted', 'Work Intervention version cannot be advanced safely.', 409);
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const nextVersion = currentVersion + 1;
      const responseRecord = fieldFirestoreData({
        id: responseId,
        fieldAuthorityVersion: FIELD_FREE_TEXT_RESPONSE_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
        value: normalizedValue,
        technicianStaffId: staffId,
        respondedAt: occurredAt,
        lastRequestId: stable,
        createdAt: existing ? responseSnapshot.data()?.createdAt : occurredAt,
        createdByUserId: existing ? responseSnapshot.data()?.createdByUserId : text(identity?.uid, 180),
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: staffId,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: nextVersion,
      }, 'fieldFreeTextResponse');
      const response = projectFieldFreeTextResponse(responseRecord, exactContext);
      const currentSectionStatus = storedIntervention.reportSectionStatus && typeof storedIntervention.reportSectionStatus === 'object'
        ? { ...storedIntervention.reportSectionStatus }
        : {};
      const completed = normalizedValue.length > 0;
      currentSectionStatus[normalizedSectionId] = completed ? 'completed' : 'in_progress';
      const interventionPatch = fieldFirestoreData({
        reportSectionStatus: currentSectionStatus,
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: staffId,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: intervention.version + 1,
      }, 'workInterventionFreeText');
      const event = freeTextAuditEvent({
        requestId: stable,
        response,
        context,
        identity,
        occurredAt,
        previousValue: existing?.value,
      });

      if (existing) transaction.update(responseRef, responseRecord);
      else transaction.create(responseRef, responseRecord);
      transaction.update(interventionRef, interventionPatch);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = {
        success: true,
        replayed: false,
        response,
        sectionCompleted: completed,
        workInterventionVersion: intervention.version + 1,
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

async function loadFieldFreeTextResponses(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const context = { ...expectedContext, visitId: normalizedVisitId };
  const snapshot = await db.collection(FIELD_FREE_TEXT_RESPONSE_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return (snapshot?.docs || [])
    .map(fieldSnapshotRecord)
    .map((record) => projectFieldFreeTextResponse(record, context))
    .sort((left, right) => left.interventionId.localeCompare(right.interventionId) || left.sectionId.localeCompare(right.sectionId));
}

module.exports.FIELD_FREE_TEXT_MAX_LENGTH = FIELD_FREE_TEXT_MAX_LENGTH;
module.exports.FIELD_FREE_TEXT_RESPONSE_COLLECTION = FIELD_FREE_TEXT_RESPONSE_COLLECTION;
module.exports.FIELD_FREE_TEXT_RESPONSE_STORAGE_VERSION = FIELD_FREE_TEXT_RESPONSE_STORAGE_VERSION;
module.exports.createSetFieldFreeTextResponseCommand = createSetFieldFreeTextResponseCommand;
module.exports.freeTextAuditEvent = freeTextAuditEvent;
module.exports.freeTextResponseId = freeTextResponseId;
module.exports.loadFieldFreeTextResponses = loadFieldFreeTextResponses;
module.exports.projectFieldFreeTextResponse = projectFieldFreeTextResponse;
