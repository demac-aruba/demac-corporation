const { canonicalizeVanCatalog, resolveCanonicalVanId } = require('./bookingVanIdentity');
const { resolveCrewMembership } = require('./bookingSchedulingPrimitives');
const {
  allowedActionsForAssignment,
  fieldAssignmentForIdentity,
  fieldError,
  validDateKey,
} = require('./fieldOperationsAuthorityCore');

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function snapshotItems(snapshot) {
  return (snapshot?.docs || []).map((document) => ({ id: document.id, ...document.data() }));
}

async function loadMutationCrewContext({ db, transaction, dateKey }) {
  if (!db || typeof db.collection !== 'function') throw new Error('A Firestore-compatible db is required.');
  if (!transaction || typeof transaction.get !== 'function') throw new Error('A Firestore transaction is required.');
  const normalizedDate = validDateKey(dateKey);

  // These reads intentionally happen through the same transaction that will mutate Field truth.
  // That closes the time-of-check/time-of-use gap between a dated crew override and the write.
  const [assignmentSnapshot, vansSnapshot] = await Promise.all([
    transaction.get(db.collection('dailyVanAssignments').where('date', '==', normalizedDate)),
    transaction.get(db.collection('vans')),
  ]);

  const rawVans = snapshotItems(vansSnapshot);
  const catalog = canonicalizeVanCatalog(rawVans);
  const dailyAssignments = snapshotItems(assignmentSnapshot).map((assignment) => ({
    ...assignment,
    vanId: resolveCanonicalVanId(assignment.vanId, catalog.aliases) || text(assignment.vanId, 180),
  }));
  const memberships = catalog.vans.map((van) => resolveCrewMembership(van, normalizedDate, dailyAssignments));

  return {
    dailyAssignments,
    vans: catalog.vans,
    memberships,
    vanAliases: catalog.aliases,
  };
}

function requireMutationAction(identity, assignment, action, deniedMessage = 'This assignment cannot execute the requested Field action.') {
  if (!assignment?.assigned) {
    throw fieldError('permission_denied', 'You are not assigned to this Field work.', 403);
  }
  const normalizedAction = text(action, 120);
  if (!normalizedAction) throw new Error('A Field mutation action is required.');
  const allowedActions = allowedActionsForAssignment(identity, assignment);
  if (!allowedActions.includes(normalizedAction)) {
    throw fieldError('permission_denied', deniedMessage, 403, {
      action: normalizedAction,
      responsibility: assignment.responsibility || null,
      source: assignment.source || null,
    });
  }
  return allowedActions;
}

function requireMutationExecution(identity, assignment, deniedMessage = 'This assignment cannot execute Field mutations.') {
  return requireMutationAction(identity, assignment, 'execute', deniedMessage);
}

function createMutationAssignmentResolver({ db } = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('A Firestore-compatible db is required.');

  return async function resolveMutationAssignment({ transaction, identity, order } = {}) {
    if (!order || typeof order !== 'object') throw new Error('A Work Order is required to resolve Field mutation assignment.');
    const dateKey = validDateKey(order.date);
    const context = await loadMutationCrewContext({ db, transaction, dateKey });
    return {
      ...fieldAssignmentForIdentity(identity, order, dateKey, context),
      context,
    };
  };
}

module.exports.createMutationAssignmentResolver = createMutationAssignmentResolver;
module.exports.loadMutationCrewContext = loadMutationCrewContext;
module.exports.requireMutationAction = requireMutationAction;
module.exports.requireMutationExecution = requireMutationExecution;
