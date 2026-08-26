'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  projectStoredReportTemplateSnapshot,
  requireReportChecklistItem,
} = require('./fieldOperationsReportTemplates');
const {
  WORK_INTERVENTION_COLLECTION,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

const FIELD_CHECKLIST_RESPONSE_STORAGE_VERSION = 1;
const FIELD_CHECKLIST_RESPONSE_COLLECTION = 'fieldChecklistResponses';

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function checklistResponseId(interventionId, sectionId, itemId) {
  const intervention = text(interventionId, 180);
  const section = text(sectionId, 120);
  const item = text(itemId, 120);
  if (!intervention || !section || !item) throw new Error('Checklist response identity is required.');
  return deterministicId('CHECK', `${intervention}:${section}:${item}`);
}

function projectFieldChecklistResponse(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_CHECKLIST_RESPONSE_STORAGE_VERSION) {
    throw fieldError('invalid_field_checklist_response_schema', 'Persisted checklist response storage version is invalid.', 409);
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
    itemId: text(record?.itemId, 120),
  };
  if (Object.values(required).some((value) => !value)) {
    throw fieldError('field_checklist_response_identity_conflict', 'Persisted checklist response identity is incomplete.', 409);
  }
  for (const [key, expected] of Object.entries(expectedContext)) {
    const limit = key === 'sectionId' || key === 'itemId' ? 120 : 180;
    const normalizedExpected = text(expected, limit);
    if (normalizedExpected && required[key] !== normalizedExpected) {
      throw fieldError('field_checklist_response_identity_conflict', 'Persisted checklist response does not match its authorized context.', 409, { key });
    }
  }
  if (typeof record?.checked !== 'boolean') {
    throw fieldError('invalid_field_checklist_response', 'Persisted checklist response checked state is invalid.', 409);
  }
  const technicianStaffId = text(record?.technicianStaffId, 180);
  const respondedAt = text(record?.respondedAt, 80);
  const lastRequestId = text(record?.lastRequestId, 240);
  const version = Number(record?.version);
  if (!technicianStaffId || !respondedAt || Number.isNaN(Date.parse(respondedAt)) || lastRequestId.length < 8) {
    throw fieldError('invalid_field_checklist_response', 'Persisted checklist response metadata is invalid.', 409);
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw fieldError('invalid_field_checklist_response_version', 'Persisted checklist response version is invalid.', 409);
  }
  return {
    id: required.id,
    visitId: required.visitId,
    visitAssetId: required.visitAssetId,
    assetId: required.assetId,
    interventionId: required.interventionId,
    sectionId: required.sectionId,
    itemId: required.itemId,
    checked: record.checked,
    technicianStaffId,
    respondedAt,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version,
  };
}

function checklistAuditEvent({ requestId, response, context, identity, occurredAt, previousChecked }) {
  return {
    id: deterministicId('FE', `${requestId}:report_checklist_item_changed:${response.id}`),
    type: 'report_checklist_item_changed',
    entityType: 'FieldChecklistResponse',
    entityId: response.id,
    visitId: response.visitId,
    visitAssetId: response.visitAssetId,
    assetId: response.assetId,
    interventionId: response.interventionId,
    sectionId: response.sectionId,
    itemId: response.itemId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity?.uid, 180),
    performedByStaffId: text(identity?.staffId, 180) || undefined,
    performedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    before: { checked: previousChecked ?? null },
    after: { checked: response.checked },
  };
}

function createSetFieldChecklistItemCommand({
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

  return async function setFieldChecklistItem({
    identity,
    visitId,
    interventionId,
    sectionId,
    itemId,
    checked,
    expectedVersion,
    requestId,
  } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedSectionId = text(sectionId, 120);
    const normalizedItemId = text(itemId, 120);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    if (!normalizedSectionId) throw fieldError('report_section_required', 'A report section id is required.', 400);
    if (!normalizedItemId) throw fieldError('report_checklist_item_required', 'A checklist item id is required.', 400);
    if (typeof checked !== 'boolean') throw fieldError('report_checklist_checked_required', 'Checklist checked state must be boolean.', 400);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw fieldError('expected_version_required', 'Checklist expectedVersion must be a non-negative safe integer.', 400);
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
        deniedMessage: 'This assignment cannot edit the technical report checklist.',
      });
      if (context.canonicalVisit.status !== 'in_progress') {
        throw fieldError('field_checklist_not_allowed', 'Checklist responses can only be edited while the physical visit is in progress.', 409, {
          visitStatus: context.canonicalVisit.status,
        });
      }
      const staffId = text(identity?.staffId, 180);
      if (!staffId) throw fieldError('technician_staff_required', 'Checklist responses require a DEMAC staff identity.', 403);
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
        throw fieldError('field_checklist_not_allowed', 'Checklist responses require an in-progress Work Intervention.', 409, {
          interventionStatus: intervention.status,
        });
      }
      const template = projectStoredReportTemplateSnapshot(storedIntervention.reportTemplateSnapshot, intervention.serviceCatalogItemId);
      if (!template) throw fieldError('report_template_not_available', 'This Work Intervention has no frozen report template.', 409);
      const { section } = requireReportChecklistItem(template, normalizedSectionId, normalizedItemId);

      const responseId = checklistResponseId(normalizedInterventionId, normalizedSectionId, normalizedItemId);
      const responseRef = db.collection(FIELD_CHECKLIST_RESPONSE_COLLECTION).doc(responseId);
      const exactContext = {
        ...expectedContext,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
        itemId: normalizedItemId,
      };
      const responseSnapshot = await transaction.get(responseRef);
      const existing = responseSnapshot.exists
        ? projectFieldChecklistResponse(fieldSnapshotRecord(responseSnapshot), exactContext)
        : null;
      const storedLastRequestId = responseSnapshot.exists ? text(responseSnapshot.data()?.lastRequestId, 240) : '';
      if (existing && storedLastRequestId === stable) {
        if (existing.checked !== checked) {
          throw fieldError('field_checklist_request_conflict', 'This requestId was already used for a different checklist state.', 409);
        }
        result = {
          success: true,
          replayed: true,
          response: existing,
          workInterventionVersion: intervention.version,
          allowedActions: context.allowedActions,
        };
        return;
      }
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        throw fieldError('version_conflict', 'This checklist item changed on another device. Refresh before trying again.', 409, {
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
        fieldAuthorityVersion: FIELD_CHECKLIST_RESPONSE_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        visitAssetId: intervention.visitAssetId,
        assetId: intervention.assetId,
        interventionId: intervention.id,
        sectionId: normalizedSectionId,
        itemId: normalizedItemId,
        checked,
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
      }, 'fieldChecklistResponse');
      const response = projectFieldChecklistResponse(responseRecord, exactContext);

      const sectionQuery = db.collection(FIELD_CHECKLIST_RESPONSE_COLLECTION)
        .where('interventionId', '==', intervention.id)
        .where('sectionId', '==', normalizedSectionId);
      const sectionSnapshot = await transaction.get(sectionQuery);
      const stateByItemId = new Map(
        (sectionSnapshot?.docs || [])
          .map(fieldSnapshotRecord)
          .map((record) => projectFieldChecklistResponse(record, {
            ...expectedContext,
            visitAssetId: intervention.visitAssetId,
            assetId: intervention.assetId,
            interventionId: intervention.id,
            sectionId: normalizedSectionId,
          }))
          .map((current) => [current.itemId, current.checked]),
      );
      stateByItemId.set(normalizedItemId, checked);
      const checklistItems = Array.isArray(section.checklistItems) ? section.checklistItems : [];
      const completed = checklistItems.length > 0 && checklistItems.every((item) => stateByItemId.get(item.id) === true);
      const currentSectionStatus = storedIntervention.reportSectionStatus && typeof storedIntervention.reportSectionStatus === 'object'
        ? { ...storedIntervention.reportSectionStatus }
        : {};
      currentSectionStatus[normalizedSectionId] = completed ? 'completed' : 'in_progress';
      const interventionPatch = fieldFirestoreData({
        reportSectionStatus: currentSectionStatus,
        updatedAt: occurredAt,
        updatedByUserId: text(identity?.uid, 180),
        updatedByStaffId: staffId,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
        version: intervention.version + 1,
      }, 'workInterventionChecklist');
      const event = checklistAuditEvent({
        requestId: stable,
        response,
        context,
        identity,
        occurredAt,
        previousChecked: existing?.checked,
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

async function loadFieldChecklistResponses(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const context = { ...expectedContext, visitId: normalizedVisitId };
  const snapshot = await db.collection(FIELD_CHECKLIST_RESPONSE_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return (snapshot?.docs || [])
    .map(fieldSnapshotRecord)
    .map((record) => projectFieldChecklistResponse(record, context))
    .sort((left, right) => left.sectionId.localeCompare(right.sectionId) || left.itemId.localeCompare(right.itemId));
}

module.exports.FIELD_CHECKLIST_RESPONSE_COLLECTION = FIELD_CHECKLIST_RESPONSE_COLLECTION;
module.exports.FIELD_CHECKLIST_RESPONSE_STORAGE_VERSION = FIELD_CHECKLIST_RESPONSE_STORAGE_VERSION;
module.exports.checklistAuditEvent = checklistAuditEvent;
module.exports.checklistResponseId = checklistResponseId;
module.exports.createSetFieldChecklistItemCommand = createSetFieldChecklistItemCommand;
module.exports.loadFieldChecklistResponses = loadFieldChecklistResponses;
module.exports.projectFieldChecklistResponse = projectFieldChecklistResponse;