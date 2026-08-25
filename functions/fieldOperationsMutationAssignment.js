const { canonicalizeVanCatalog, resolveCanonicalVanId } = require('./bookingVanIdentity');
const { resolveCrewMembership } = require('./bookingSchedulingPrimitives');
const { fieldAssignmentForIdentity, validDateKey } = require('./fieldOperationsAuthorityCore');

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
