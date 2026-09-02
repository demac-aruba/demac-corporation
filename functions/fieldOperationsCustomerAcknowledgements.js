'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const { projectStoredReportTemplateSnapshot, requireReportTemplateSection } = require('./fieldOperationsReportTemplates');
const { WORK_INTERVENTION_COLLECTION, projectWorkIntervention } = require('./fieldOperationsVisitInterventions');

const FIELD_CUSTOMER_ACK_STORAGE_VERSION = 1;
const FIELD_CUSTOMER_ACK_COLLECTION = 'fieldCustomerAcknowledgements';
const FIELD_CUSTOMER_ACK_METHOD = 'verbal';

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function customerAcknowledgementId(interventionId, sectionId) {
  const intervention = text(interventionId, 180);
  const section = text(sectionId, 120);
  if (!intervention || !section) throw new Error('Customer acknowledgement identity is required.');
  return deterministicId('CACK', `${intervention}:${section}`);
}

function projectCustomerAcknowledgement(record, expectedContext = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_CUSTOMER_ACK_STORAGE_VERSION) {
    throw fieldError('invalid_customer_acknowledgement_schema', 'Persisted customer acknowledgement storage version is invalid.', 409);
  }
  const required = {
    id: text(record?.id, 180), visitId: text(record?.visitId, 180), workOrderId: text(record?.workOrderId, 180),
    customerId: text(record?.clientId || record?.customerId, 180), propertyId: text(record?.propertyId || record?.siteId, 180),
    visitAssetId: text(record?.visitAssetId, 180), assetId: text(record?.assetId, 180), interventionId: text(record?.interventionId, 180),
    sectionId: text(record?.sectionId, 120),
  };
  if (Object.values(required).some((value) => !value)) {
    throw fieldError('customer_acknowledgement_identity_conflict', 'Persisted customer acknowledgement identity is incomplete.', 409);
  }
  for (const [key, expected] of Object.entries(expectedContext)) {
    const normalized = text(expected, key === 'sectionId' ? 120 : 180);
    if (normalized && required[key] !== normalized) {
      throw fieldError('customer_acknowledgement_identity_conflict', 'Persisted customer acknowledgement does not match its authorized context.', 409, { key });
    }
  }
  const receiverName = text(record?.receiverName, 180);
  const method = text(record?.method, 40);
  const acknowledgedAt = text(record?.acknowledgedAt, 80);
  const recordedByStaffId = text(record?.recordedByStaffId, 180);
  const requestId = text(record?.requestId, 240);
  const version = Number(record?.version);
  if (!receiverName || method !== FIELD_CUSTOMER_ACK_METHOD || !acknowledgedAt || Number.isNaN(Date.parse(acknowledgedAt)) || !recordedByStaffId || requestId.length < 8) {
    throw fieldError('invalid_customer_acknowledgement', 'Persisted customer acknowledgement metadata is invalid.', 409);
  }
  if (!Number.isSafeInteger(version) || version !== 1) {
    throw fieldError('invalid_customer_acknowledgement_version', 'Customer acknowledgement must be immutable version 1 evidence.', 409);
  }
  return {
    id: required.id,
    visitId: required.visitId,
    visitAssetId: required.visitAssetId,
    assetId: required.assetId,
    interventionId: required.interventionId,
    sectionId: required.sectionId,
    receiverName,
    method,
    note: text(record?.note, 1000) || undefined,
    acknowledgedAt,
    recordedByStaffId,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    version,
  };
}

function acknowledgementAuditEvent({ requestId, acknowledgement, context, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:customer_report_acknowledged:${acknowledgement.id}`),
    type: 'customer_report_acknowledged', entityType: 'FieldCustomerAcknowledgement', entityId: acknowledgement.id,
    visitId: acknowledgement.visitId, visitAssetId: acknowledgement.visitAssetId, assetId: acknowledgement.assetId,
    interventionId: acknowledgement.interventionId, sectionId: acknowledgement.sectionId,
    workOrderId: context.workOrderId, appointmentId: context.appointmentId, customerId: context.customerId, propertyId: context.propertyId,
    requestId, occurredAt, performedByUserId: text(identity?.uid, 180), performedByStaffId: text(identity?.staffId, 180) || undefined,
    performedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    before: null,
    after: { receiverName: acknowledgement.receiverName, method: acknowledgement.method, acknowledgedAt: acknowledgement.acknowledgedAt },
  };
}

function createRecordCustomerAcknowledgementCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function recordCustomerAcknowledgement({ identity, visitId, interventionId, sectionId, receiverName, note, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedSectionId = text(sectionId, 120);
    const normalizedReceiverName = text(receiverName, 180);
    const normalizedNote = text(note, 1000);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedInterventionId) throw fieldError('work_intervention_required', 'A Work Intervention id is required.', 400);
    if (!normalizedSectionId) throw fieldError('report_section_required', 'A report section id is required.', 400);
    if (!normalizedReceiverName) throw fieldError('customer_acknowledgement_receiver_required', 'The customer or receiver name is required.', 400);
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db, transaction, identity, visitId: normalizedVisitId, resolveAssignment, action: 'execute',
        deniedMessage: 'This assignment cannot record customer acknowledgement evidence.',
      });
      if (context.canonicalVisit.status !== 'in_progress') {
        throw fieldError('customer_acknowledgement_not_allowed', 'Customer acknowledgement can only be recorded while the physical visit is in progress.', 409, { visitStatus: context.canonicalVisit.status });
      }
      const staffId = text(identity?.staffId, 180);
      if (!staffId) throw fieldError('technician_staff_required', 'Customer acknowledgement requires a DEMAC staff identity.', 403);
      const expectedContext = { visitId: normalizedVisitId, workOrderId: context.workOrderId, customerId: context.customerId, propertyId: context.propertyId };
      const interventionRef = db.collection(WORK_INTERVENTION_COLLECTION).doc(normalizedInterventionId);
      const interventionSnapshot = await transaction.get(interventionRef);
      if (!interventionSnapshot.exists) throw fieldError('work_intervention_not_found', 'The selected Work Intervention is not available for this visit.', 404);
      const storedIntervention = fieldSnapshotRecord(interventionSnapshot);
      const intervention = projectWorkIntervention(storedIntervention, expectedContext);
      if (intervention.status !== 'in_progress') {
        throw fieldError('customer_acknowledgement_not_allowed', 'Customer acknowledgement requires an in-progress Work Intervention.', 409, { interventionStatus: intervention.status });
      }
      const template = projectStoredReportTemplateSnapshot(storedIntervention.reportTemplateSnapshot, intervention.serviceCatalogItemId);
      if (!template) throw fieldError('report_template_not_available', 'This Work Intervention has no frozen report template.', 409);
      requireReportTemplateSection(template, normalizedSectionId, 'customer_acknowledgement');

      const acknowledgementId = customerAcknowledgementId(normalizedInterventionId, normalizedSectionId);
      const acknowledgementRef = db.collection(FIELD_CUSTOMER_ACK_COLLECTION).doc(acknowledgementId);
      const acknowledgementSnapshot = await transaction.get(acknowledgementRef);
      const exactContext = { ...expectedContext, visitAssetId: intervention.visitAssetId, assetId: intervention.assetId, interventionId: intervention.id, sectionId: normalizedSectionId };
      if (acknowledgementSnapshot.exists) {
        const existing = projectCustomerAcknowledgement(fieldSnapshotRecord(acknowledgementSnapshot), exactContext);
        const storedRequestId = text(acknowledgementSnapshot.data()?.requestId, 240);
        if (storedRequestId === stable && existing.receiverName === normalizedReceiverName && (existing.note || '') === normalizedNote) {
          result = { success: true, replayed: true, acknowledgement: existing, workInterventionVersion: intervention.version, allowedActions: context.allowedActions };
          return;
        }
        throw fieldError('customer_acknowledgement_already_recorded', 'Customer acknowledgement is immutable once recorded. Office Review is required to correct it.', 409);
      }
      if (!Number.isSafeInteger(intervention.version) || intervention.version >= Number.MAX_SAFE_INTEGER) {
        throw fieldError('work_intervention_version_exhausted', 'Work Intervention version cannot be advanced safely.', 409);
      }
      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const record = fieldFirestoreData({
        id: acknowledgementId, fieldAuthorityVersion: FIELD_CUSTOMER_ACK_STORAGE_VERSION,
        visitId: normalizedVisitId, workOrderId: context.workOrderId, clientId: context.customerId, propertyId: context.propertyId,
        visitAssetId: intervention.visitAssetId, assetId: intervention.assetId, interventionId: intervention.id, sectionId: normalizedSectionId,
        receiverName: normalizedReceiverName, method: FIELD_CUSTOMER_ACK_METHOD, note: normalizedNote || undefined,
        acknowledgedAt: occurredAt, recordedByStaffId: staffId, requestId: stable,
        createdAt: occurredAt, createdByUserId: text(identity?.uid, 180), version: 1,
      }, 'fieldCustomerAcknowledgement');
      const acknowledgement = projectCustomerAcknowledgement(record, exactContext);
      const reportSectionStatus = storedIntervention.reportSectionStatus && typeof storedIntervention.reportSectionStatus === 'object'
        ? { ...storedIntervention.reportSectionStatus }
        : {};
      reportSectionStatus[normalizedSectionId] = 'completed';
      const interventionPatch = fieldFirestoreData({
        reportSectionStatus, updatedAt: occurredAt, updatedByUserId: text(identity?.uid, 180), updatedByStaffId: staffId,
        updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180), version: intervention.version + 1,
      }, 'workInterventionCustomerAcknowledgement');
      const event = acknowledgementAuditEvent({ requestId: stable, acknowledgement, context, identity, occurredAt });
      transaction.create(acknowledgementRef, record);
      transaction.update(interventionRef, interventionPatch);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = { success: true, replayed: false, acknowledgement, workInterventionVersion: intervention.version + 1, allowedActions: context.allowedActions, auditEventId: event.id };
    });
    return result;
  };
}

async function loadCustomerAcknowledgements(db, visitId, expectedContext = {}) {
  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) return [];
  const snapshot = await db.collection(FIELD_CUSTOMER_ACK_COLLECTION).where('visitId', '==', normalizedVisitId).get();
  return (snapshot?.docs || []).map(fieldSnapshotRecord)
    .map((record) => projectCustomerAcknowledgement(record, { ...expectedContext, visitId: normalizedVisitId }))
    .sort((left, right) => left.interventionId.localeCompare(right.interventionId) || left.sectionId.localeCompare(right.sectionId));
}

module.exports.FIELD_CUSTOMER_ACK_COLLECTION = FIELD_CUSTOMER_ACK_COLLECTION;
module.exports.FIELD_CUSTOMER_ACK_METHOD = FIELD_CUSTOMER_ACK_METHOD;
module.exports.FIELD_CUSTOMER_ACK_STORAGE_VERSION = FIELD_CUSTOMER_ACK_STORAGE_VERSION;
module.exports.acknowledgementAuditEvent = acknowledgementAuditEvent;
module.exports.createRecordCustomerAcknowledgementCommand = createRecordCustomerAcknowledgementCommand;
module.exports.customerAcknowledgementId = customerAcknowledgementId;
module.exports.loadCustomerAcknowledgements = loadCustomerAcknowledgements;
module.exports.projectCustomerAcknowledgement = projectCustomerAcknowledgement;
