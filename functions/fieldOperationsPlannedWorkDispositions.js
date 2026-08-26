'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const {
  WORK_INTERVENTION_COLLECTION,
  coveringIntervention,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

const PLANNED_WORK_DISPOSITION_COLLECTION = 'plannedWorkDispositions';
const PLANNED_WORK_DISPOSITION_STORAGE_VERSION = 1;
const PLANNED_WORK_DISPOSITION_REASONS = new Set([
  'customer_cancelled',
  'inaccessible',
  'unsafe',
  'deferred',
  'equipment_unavailable',
  'other',
]);
const MUTABLE_VISIT_STATUSES = new Set(['on_site', 'in_progress', 'pending']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function records(snapshot) {
  return (snapshot?.docs || []).map(fieldSnapshotRecord);
}

function requiredReference(record, field, label) {
  const value = text(record?.[field], 180);
  if (!value) throw fieldError('planned_work_disposition_identity_conflict', `Persisted Planned Work Disposition ${label} is missing.`, 409);
  return value;
}

function projectPlannedWorkDisposition(record, expected = {}) {
  if (record?.fieldAuthorityVersion !== PLANNED_WORK_DISPOSITION_STORAGE_VERSION) {
    throw fieldError('invalid_planned_work_disposition_schema', 'Persisted Planned Work Disposition schema is invalid.', 409);
  }
  const id = text(record?.id, 180);
  if (!id) throw fieldError('planned_work_disposition_identity_conflict', 'Persisted Planned Work Disposition id is missing.', 409);
  const visitId = requiredReference(record, 'visitId', 'Work Visit identity');
  const workOrderId = requiredReference(record, 'workOrderId', 'Work Order identity');
  const customerId = text(record?.clientId || record?.customerId, 180);
  const propertyId = requiredReference(record, 'propertyId', 'Property identity');
  const plannedWorkLineId = requiredReference(record, 'plannedWorkLineId', 'planned work line identity');
  const reasonCode = text(record?.reasonCode, 80);
  const note = text(record?.note, 1500);
  const quantity = record?.quantity;
  if (!customerId) throw fieldError('planned_work_disposition_identity_conflict', 'Persisted Planned Work Disposition Customer identity is missing.', 409);
  if (!PLANNED_WORK_DISPOSITION_REASONS.has(reasonCode)) {
    throw fieldError('invalid_planned_work_disposition_reason', 'Persisted Planned Work Disposition reason is invalid.', 409);
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw fieldError('invalid_planned_work_disposition_quantity', 'Persisted Planned Work Disposition quantity is invalid.', 409);
  }
  if (reasonCode === 'other' && note.length < 3) {
    throw fieldError('invalid_planned_work_disposition_note', 'Other Planned Work Disposition requires a short explanation.', 409);
  }
  const version = record?.version;
  if (version !== 1) throw fieldError('invalid_planned_work_disposition_version', 'Planned Work Disposition is immutable version 1 evidence.', 409);
  const createdAt = text(record?.createdAt, 80);
  const createdBy = text(record?.createdByUserId || record?.createdBy, 180);
  if (!createdAt || Number.isNaN(Date.parse(createdAt)) || !createdBy) {
    throw fieldError('invalid_planned_work_disposition_audit', 'Persisted Planned Work Disposition audit metadata is invalid.', 409);
  }
  const expectedPairs = [
    ['visitId', visitId], ['workOrderId', workOrderId], ['customerId', customerId], ['propertyId', propertyId],
  ];
  for (const [key, actual] of expectedPairs) {
    const wanted = text(expected?.[key], 180);
    if (wanted && wanted !== actual) {
      throw fieldError('planned_work_disposition_identity_conflict', `Planned Work Disposition ${key} does not match the authorized job.`, 409);
    }
  }
  return { id, visitId, workOrderId, customerId, propertyId, plannedWorkLineId, quantity, reasonCode, note: note || undefined, createdAt, createdBy, version: 1 };
}

function dispositionQuantityByLine(dispositions = []) {
  const totals = new Map();
  for (const item of dispositions) totals.set(item.plannedWorkLineId, (totals.get(item.plannedWorkLineId) || 0) + item.quantity);
  return totals;
}

function reconcilePlannedWorkProgress(progress = [], dispositions = []) {
  const disposedByLine = dispositionQuantityByLine(dispositions);
  return progress.map((line) => {
    const disposedQuantity = disposedByLine.get(line.id) || 0;
    if (!Number.isSafeInteger(line.plannedQuantity) || line.plannedQuantity < 0
      || !Number.isSafeInteger(line.linkedActualQuantity) || line.linkedActualQuantity < 0
      || !Number.isSafeInteger(line.remainingQuantity) || line.remainingQuantity < 0
      || disposedQuantity > line.remainingQuantity) {
      throw fieldError('planned_work_disposition_state_conflict', 'Planned Work Dispositions exceed canonical unreconciled planned quantity.', 409, {
        plannedWorkLineId: line.id,
        disposedQuantity,
        remainingQuantity: line.remainingQuantity,
      });
    }
    return {
      ...line,
      disposedQuantity,
      remainingQuantity: line.remainingQuantity - disposedQuantity,
    };
  });
}

function dispositionOptions(job, progress) {
  if (!job?.fieldVisit || !MUTABLE_VISIT_STATUSES.has(text(job.fieldVisit.status, 80))) return [];
  if (!Array.isArray(job.allowedActions) || !job.allowedActions.includes('intervention.complete')) return [];
  return progress.filter((line) => line.remainingQuantity > 0).map((line) => ({
    plannedWorkLineId: line.id,
    maxQuantity: line.remainingQuantity,
  }));
}

async function loadPlannedWorkDispositions(db, job) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) return [];
  const snapshot = await db.collection(PLANNED_WORK_DISPOSITION_COLLECTION).where('visitId', '==', visitId).get();
  const expected = {
    visitId,
    workOrderId: text(job.workOrderId, 180),
    customerId: text(job.customerId, 180),
    propertyId: text(job.propertyId, 180),
  };
  const lineIds = new Set((job.plannedWork || []).map((line) => text(line.id, 180)).filter(Boolean));
  return records(snapshot).map((record) => projectPlannedWorkDisposition(record, expected)).map((item) => {
    if (!lineIds.has(item.plannedWorkLineId)) {
      throw fieldError('planned_work_disposition_identity_conflict', 'Planned Work Disposition references a line outside the immutable planned scope.', 409);
    }
    return item;
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function attachPlannedWorkDispositionsToJob(db, job) {
  const dispositions = await loadPlannedWorkDispositions(db, job);
  const progress = reconcilePlannedWorkProgress(job?.plannedWorkProgress || [], dispositions);
  const options = dispositionOptions(job, progress);
  const availableLines = new Set(progress.filter((line) => line.remainingQuantity > 0).map((line) => line.id));
  const plannedInterventionOptions = (job?.plannedInterventionOptions || []).map((option) => ({
    ...option,
    plannedWorkLineIds: option.plannedWorkLineIds.filter((lineId) => availableLines.has(lineId)),
  })).filter((option) => option.plannedWorkLineIds.length > 0);
  return {
    ...job,
    plannedWorkDispositions: dispositions,
    plannedWorkProgress: progress,
    plannedInterventionOptions,
    canAddPlannedIntervention: Boolean(job?.canAddPlannedIntervention && plannedInterventionOptions.length > 0),
    plannedWorkDispositionOptions: options,
    canRecordPlannedWorkDisposition: options.length > 0,
  };
}

function auditEvent({ disposition, context, identity, requestId, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:planned_work_disposition:${disposition.id}`),
    type: 'planned_work_disposition_recorded',
    entityType: 'PlannedWorkDisposition',
    entityId: disposition.id,
    visitId: disposition.visitId,
    workOrderId: context.workOrderId,
    appointmentId: context.appointmentId,
    customerId: context.customerId,
    propertyId: context.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    after: {
      plannedWorkLineId: disposition.plannedWorkLineId,
      quantity: disposition.quantity,
      reasonCode: disposition.reasonCode,
    },
  };
}

function createRecordPlannedWorkDispositionCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function recordPlannedWorkDisposition({ identity, visitId, plannedWorkLineId, quantity, reasonCode, note, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedLineId = text(plannedWorkLineId, 180);
    const normalizedReason = text(reasonCode, 80);
    const normalizedNote = text(note, 1500);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedLineId) throw fieldError('planned_work_line_required', 'A planned work line id is required.', 400);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw fieldError('planned_work_disposition_quantity_required', 'Disposition quantity must be a positive integer.', 400);
    if (!PLANNED_WORK_DISPOSITION_REASONS.has(normalizedReason)) throw fieldError('planned_work_disposition_reason_required', 'A canonical Planned Work Disposition reason is required.', 400);
    if (normalizedReason === 'other' && normalizedNote.length < 3) throw fieldError('planned_work_disposition_note_required', 'Other disposition requires a short explanation.', 400);
    const stable = stableRequestId(requestId);
    const dispositionId = deterministicId('PWD', `${normalizedVisitId}:${stable}`);
    let result;

    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db, transaction, identity, visitId: normalizedVisitId, resolveAssignment,
        action: 'intervention.complete',
        deniedMessage: 'This assignment cannot reconcile planned work that was not performed.',
      });
      if (!MUTABLE_VISIT_STATUSES.has(context.canonicalVisit.status)) {
        throw fieldError('planned_work_disposition_not_allowed', 'Planned work can only be reconciled while the physical visit is active.', 409);
      }
      const line = (context.canonicalVisit.scheduledScopeSnapshot?.workLines || []).find((candidate) => text(candidate?.id, 180) === normalizedLineId);
      const plannedQuantity = Number(line?.quantity);
      if (!line || !Number.isSafeInteger(plannedQuantity) || plannedQuantity < 1) {
        throw fieldError('planned_work_line_not_found', 'The selected planned work line is not available in the immutable visit scope.', 404);
      }
      const expected = {
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        customerId: context.customerId,
        propertyId: context.propertyId,
      };
      const dispositionRef = db.collection(PLANNED_WORK_DISPOSITION_COLLECTION).doc(dispositionId);
      const existing = await transaction.get(dispositionRef);
      if (existing.exists) {
        const projected = projectPlannedWorkDisposition(fieldSnapshotRecord(existing), expected);
        if (projected.plannedWorkLineId === normalizedLineId
          && projected.quantity === quantity
          && projected.reasonCode === normalizedReason
          && (projected.note || '') === normalizedNote) {
          result = { success: true, replayed: true, disposition: projected, allowedActions: context.allowedActions };
          return;
        }
        throw fieldError('planned_work_disposition_request_conflict', 'This request id was already used with different disposition details.', 409);
      }

      const [interventionsSnapshot, dispositionsSnapshot] = await Promise.all([
        transaction.get(db.collection(WORK_INTERVENTION_COLLECTION).where('visitId', '==', normalizedVisitId)),
        transaction.get(db.collection(PLANNED_WORK_DISPOSITION_COLLECTION).where('visitId', '==', normalizedVisitId)),
      ]);
      const linkedActualQuantity = records(interventionsSnapshot)
        .map((record) => projectWorkIntervention(record, expected))
        .filter((intervention) => intervention.plannedWorkLineId === normalizedLineId && coveringIntervention(intervention)).length;
      const disposedQuantity = records(dispositionsSnapshot)
        .map((record) => projectPlannedWorkDisposition(record, expected))
        .filter((item) => item.plannedWorkLineId === normalizedLineId)
        .reduce((total, item) => total + item.quantity, 0);
      const remainingQuantity = plannedQuantity - linkedActualQuantity - disposedQuantity;
      if (remainingQuantity < quantity) {
        throw fieldError('planned_work_disposition_exceeds_remaining', 'Disposition quantity exceeds the unreconciled planned quantity.', 409, {
          plannedQuantity, linkedActualQuantity, disposedQuantity, remainingQuantity,
        });
      }
      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const stored = fieldFirestoreData({
        id: dispositionId,
        fieldAuthorityVersion: PLANNED_WORK_DISPOSITION_STORAGE_VERSION,
        visitId: normalizedVisitId,
        workOrderId: context.workOrderId,
        clientId: context.customerId,
        propertyId: context.propertyId,
        plannedWorkLineId: normalizedLineId,
        quantity,
        reasonCode: normalizedReason,
        note: normalizedNote || undefined,
        requestId: stable,
        createdAt: occurredAt,
        createdByUserId: text(identity.uid, 180),
        createdByStaffId: text(identity.staffId, 180) || undefined,
        createdByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
        version: 1,
      }, 'plannedWorkDisposition');
      const disposition = projectPlannedWorkDisposition(stored, expected);
      const event = auditEvent({ disposition, context, identity, requestId: stable, occurredAt });
      transaction.create(dispositionRef, stored);
      await appendAuditInTransaction({ transaction, event, visit: context.storedVisit, identity });
      result = { success: true, replayed: false, disposition, allowedActions: context.allowedActions, auditEventId: event.id };
    });
    return result;
  };
}

module.exports.PLANNED_WORK_DISPOSITION_COLLECTION = PLANNED_WORK_DISPOSITION_COLLECTION;
module.exports.PLANNED_WORK_DISPOSITION_REASONS = PLANNED_WORK_DISPOSITION_REASONS;
module.exports.PLANNED_WORK_DISPOSITION_STORAGE_VERSION = PLANNED_WORK_DISPOSITION_STORAGE_VERSION;
module.exports.attachPlannedWorkDispositionsToJob = attachPlannedWorkDispositionsToJob;
module.exports.createRecordPlannedWorkDispositionCommand = createRecordPlannedWorkDispositionCommand;
module.exports.dispositionOptions = dispositionOptions;
module.exports.projectPlannedWorkDisposition = projectPlannedWorkDisposition;
module.exports.reconcilePlannedWorkProgress = reconcilePlannedWorkProgress;
