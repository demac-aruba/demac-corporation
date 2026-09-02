const { fieldError } = require('./fieldOperationsAuthorityCore');
const {
  assertExistingVisitCompatible,
  projectCanonicalWorkVisit,
  workOrderAllowsInitialVisitPreparation,
} = require('./fieldOperationsAuthorityWorkVisit');
const { projectActivatedVisit } = require('./fieldOperationsVisitActions');

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

function orderedWorkVisitChain(records, workOrderId) {
  if (!Array.isArray(records) || records.length === 0) return [];
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

  const chain = [];
  cursor = leaves[0];
  while (cursor) {
    chain.push(cursor);
    const previousVisitId = text(cursor.previousVisitId, 180);
    cursor = previousVisitId ? byId.get(previousVisitId) : null;
  }
  return chain.reverse();
}

function selectCurrentWorkVisit(records, workOrderId) {
  const chain = orderedWorkVisitChain(records, workOrderId);
  return chain.length > 0 ? chain[chain.length - 1] : null;
}

function workVisitScopeSignature(visit) {
  const snapshot = visit?.scheduledScopeSnapshot || {};
  return JSON.stringify({
    appointmentId: text(snapshot.appointmentId, 180),
    capturedAt: text(snapshot.capturedAt, 80),
    estimatedUnitCount: Number(snapshot.estimatedUnitCount) || 0,
    workLines: Array.isArray(snapshot.workLines) ? snapshot.workLines : [],
    customerFacingDescription: text(snapshot.customerFacingDescription, 1500),
    technicianInstructions: text(snapshot.technicianInstructions, 1500),
  });
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
  return projectActivatedVisit(visit, job?.allowedActions);
}

function canPrepareInitialVisit(job, fieldVisit) {
  return !fieldVisit
    && Array.isArray(job?.allowedActions)
    && job.allowedActions.includes('execute')
    && workOrderAllowsInitialVisitPreparation({ status: job?.status });
}

function canCreateReturnVisit(job, fieldVisit) {
  return Boolean(fieldVisit)
    && fieldVisit.status === 'requires_return_visit'
    && fieldVisit.requiresSecondVisit === true
    && Boolean(text(fieldVisit.secondVisitReason, 1000))
    && Array.isArray(job?.allowedActions)
    && job.allowedActions.includes('execute');
}

async function loadWorkVisitChainState(db, job) {
  const workOrderId = text(job?.workOrderId, 180);
  if (!workOrderId) throw fieldError('work_order_required', 'A Work Order id is required.');
  const snapshot = await db.collection('workVisits').where('workOrderId', '==', workOrderId).get();
  const records = snapshotRecords(snapshot);
  const expectedOrderIdentity = {
    id: workOrderId,
    appointmentId: text(job?.appointmentId, 180),
    clientId: text(job?.customerId, 180),
    propertyId: text(job?.propertyId, 180),
  };
  for (const record of records) assertExistingVisitCompatible(record, expectedOrderIdentity);
  const chain = orderedWorkVisitChain(records, workOrderId);
  const record = chain.length > 0 ? chain[chain.length - 1] : null;
  return {
    chain,
    fieldVisit: projectFieldVisitState(record, job),
  };
}

async function loadCurrentWorkVisitState(db, job) {
  const state = await loadWorkVisitChainState(db, job);
  return state.fieldVisit;
}

async function attachCurrentWorkVisitState(db, job) {
  const { chain, fieldVisit } = await loadWorkVisitChainState(db, job);
  return {
    ...job,
    _fieldVisitChainIds: chain.map((record) => text(record.id, 180)),
    fieldVisit,
    canPrepareVisit: canPrepareInitialVisit(job, fieldVisit),
    canCreateReturnVisit: canCreateReturnVisit(job, fieldVisit),
  };
}

async function attachCurrentWorkVisitStates(db, jobs) {
  return Promise.all((Array.isArray(jobs) ? jobs : []).map((job) => attachCurrentWorkVisitState(db, job)));
}

module.exports.attachCurrentWorkVisitState = attachCurrentWorkVisitState;
module.exports.attachCurrentWorkVisitStates = attachCurrentWorkVisitStates;
module.exports.canPrepareInitialVisit = canPrepareInitialVisit;
module.exports.canCreateReturnVisit = canCreateReturnVisit;
module.exports.loadCurrentWorkVisitState = loadCurrentWorkVisitState;
module.exports.loadWorkVisitChainState = loadWorkVisitChainState;
module.exports.orderedWorkVisitChain = orderedWorkVisitChain;
module.exports.projectFieldVisitState = projectFieldVisitState;
module.exports.selectCurrentWorkVisit = selectCurrentWorkVisit;
module.exports.workVisitScopeSignature = workVisitScopeSignature;
