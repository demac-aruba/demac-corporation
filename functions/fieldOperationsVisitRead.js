const { fieldError } = require('./fieldOperationsAuthorityCore');
const {
  projectCanonicalWorkVisit,
  workOrderAllowsInitialVisitPreparation,
} = require('./fieldOperationsAuthorityWorkVisit');
const { activatedVisitTransitions } = require('./fieldOperationsVisitActions');

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map((document) => ({ id: document.id, ...document.data() }));
}

function ambiguousHistory(workOrderId, records, reason) {
  throw fieldError(
    'work_visit_history_ambiguous',
    'Work Visit history cannot be resolved to one current physical visit.',
    409,
    {
      workOrderId: text(workOrderId, 180),
      reason,
      visitIds: records.map((record) => text(record.id, 180)).filter(Boolean),
    },
  );
}

function selectCurrentWorkVisit(records, workOrderId) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const normalizedWorkOrderId = text(workOrderId, 180);
  const byId = new Map();

  for (const record of records) {
    const id = text(record?.id, 180);
    if (!id || text(record?.workOrderId, 180) !== normalizedWorkOrderId || byId.has(id)) {
      ambiguousHistory(normalizedWorkOrderId, records, 'invalid_identity');
    }
    byId.set(id, record);
  }

  const referencedAsPrevious = new Set();
  for (const record of records) {
    const previousVisitId = text(record?.previousVisitId, 180);
    if (!previousVisitId) continue;
    if (!byId.has(previousVisitId) || previousVisitId === text(record.id, 180)) {
      ambiguousHistory(normalizedWorkOrderId, records, 'broken_visit_chain');
    }
    referencedAsPrevious.add(previousVisitId);
  }

  const leaves = records.filter((record) => !referencedAsPrevious.has(text(record.id, 180)));
  if (leaves.length !== 1) ambiguousHistory(normalizedWorkOrderId, records, 'multiple_or_missing_chain_tip');

  const visited = new Set();
  let cursor = leaves[0];
  while (cursor) {
    const id = text(cursor.id, 180);
    if (visited.has(id)) ambiguousHistory(normalizedWorkOrderId, records, 'cycle');
    visited.add(id);
    const previousVisitId = text(cursor.previousVisitId, 180);
    cursor = previousVisitId ? byId.get(previousVisitId) : null;
  }
  if (visited.size !== records.length) ambiguousHistory(normalizedWorkOrderId, records, 'disconnected_history');

  return leaves[0];
}

function projectFieldVisitState(record, job) {
  if (!record) return null;
  const visit = projectCanonicalWorkVisit(record, {
    appointmentId: text(job?.appointmentId, 180),
    propertyId: text(job?.propertyId, 180),
  });
  if (visit.workOrderId !== text(job?.workOrderId, 180)
    || visit.customerId !== text(job?.customerId, 180)
    || visit.propertyId !== text(job?.propertyId, 180)
    || visit.appointmentId !== text(job?.appointmentId, 180)) {
    throw fieldError('visit_identity_conflict', 'The current Work Visit identity does not match this Work Order.', 409);
  }
  return {
    ...visit,
    availableTransitions: activatedVisitTransitions(visit.status, job?.allowedActions),
  };
}

function canPrepareInitialVisit(job, fieldVisit) {
  return !fieldVisit
    && Array.isArray(job?.allowedActions)
    && job.allowedActions.includes('execute')
    && workOrderAllowsInitialVisitPreparation({ status: job?.status });
}

async function loadCurrentWorkVisitState(db, job) {
  const workOrderId = text(job?.workOrderId, 180);
  if (!workOrderId) throw fieldError('work_order_required', 'A Work Order id is required.');
  const snapshot = await db.collection('workVisits').where('workOrderId', '==', workOrderId).get();
  const record = selectCurrentWorkVisit(snapshotRecords(snapshot), workOrderId);
  return projectFieldVisitState(record, job);
}

async function attachCurrentWorkVisitState(db, job) {
  const fieldVisit = await loadCurrentWorkVisitState(db, job);
  return {
    ...job,
    fieldVisit,
    canPrepareVisit: canPrepareInitialVisit(job, fieldVisit),
  };
}

async function attachCurrentWorkVisitStates(db, jobs) {
  return Promise.all((Array.isArray(jobs) ? jobs : []).map((job) => attachCurrentWorkVisitState(db, job)));
}

module.exports.attachCurrentWorkVisitState = attachCurrentWorkVisitState;
module.exports.attachCurrentWorkVisitStates = attachCurrentWorkVisitStates;
module.exports.canPrepareInitialVisit = canPrepareInitialVisit;
module.exports.loadCurrentWorkVisitState = loadCurrentWorkVisitState;
module.exports.projectFieldVisitState = projectFieldVisitState;
module.exports.selectCurrentWorkVisit = selectCurrentWorkVisit;