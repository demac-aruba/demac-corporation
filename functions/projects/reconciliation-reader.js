'use strict';
const { assertProjectScope, reconcileProjectEvidence } = require('./reconciliation');

const MAX_LOCAL_REFERENCES = 25;
const MAX_ORDERS = 50;
const MAX_VISITS_PER_ORDER = 20;
function fail(code, message) { return Object.assign(new Error(message), { code }); }
function documentRecord(snapshot) { return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null; }

/**
 * Internal read-only service. No HTTP export, SDK initialization, writes or deployment.
 * verifyIdToken must be the trusted Firebase Admin verifier, never request-supplied.
 * Initial recovery is restricted to the existing exact super_admin role.
 */
function createProjectReconciliationReader({ db, verifyIdToken }) {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.collection !== 'function'
      || typeof verifyIdToken !== 'function') throw new Error('Trusted Firestore and token verifier dependencies are required.');
  return async function readProjectReconciliation({ idToken, project }) {
    if (typeof idToken !== 'string' || !idToken || idToken.length > 16000) throw fail('unauthenticated', 'Sign in to DEMAC ERP.');
    let claims;
    try { claims = await verifyIdToken(idToken, true); } catch { throw fail('unauthenticated', 'Sign in to DEMAC ERP.'); }
    if (!claims || typeof claims.uid !== 'string' || !claims.uid || claims.uid.length > 128 || /[\x00-\x1f/]/.test(claims.uid)) throw fail('unauthenticated', 'Sign in to DEMAC ERP.');
    return db.runTransaction(async (transaction) => {
      const user = documentRecord(await transaction.get(db.collection('users').doc(claims.uid)));
      // Read the provisioned profile, not role/capabilities supplied by the browser or token.
      if (!user || user.active !== true || user.role !== 'super_admin') throw fail('forbidden', 'Owner authorization is required for project recovery.');
      assertProjectScope(project);
      const workOrderIds = [...new Set(project.assignments.map((row) => row.workOrderId).filter(Boolean))];
      const appointmentIds = [...new Set(project.assignments.map((row) => row.appointmentId).filter(Boolean))];
      if (workOrderIds.length > MAX_LOCAL_REFERENCES || appointmentIds.length > MAX_LOCAL_REFERENCES) {
        throw fail('scope_limit', 'Reconcile at most 25 local Work Order and Appointment references per request.');
      }
      const workOrders = new Map();
      const workVisits = [];
      let complete = true;
      for (const id of workOrderIds) {
        const order = documentRecord(await transaction.get(db.collection('workOrders').doc(id)));
        if (order) workOrders.set(id, order);
      }
      for (const id of appointmentIds) {
        const result = await transaction.get(db.collection('workOrders').where('appointmentId', '==', id).limit(MAX_ORDERS + 1));
        if (result.docs.length > MAX_ORDERS) complete = false;
        for (const snapshot of result.docs.slice(0, MAX_ORDERS)) workOrders.set(snapshot.id, documentRecord(snapshot));
        if (workOrders.size > MAX_ORDERS) throw fail('scope_limit', 'Too many related Work Orders. Use a smaller recovery scope.');
      }
      for (const order of workOrders.values()) {
        // Do not fan out into an unrelated customer's visit records.
        if (order.clientId !== project.customerId || order.propertyId !== project.siteId) continue;
        const result = await transaction.get(db.collection('workVisits').where('workOrderId', '==', order.id).limit(MAX_VISITS_PER_ORDER + 1));
        if (result.docs.length > MAX_VISITS_PER_ORDER) complete = false;
        for (const snapshot of result.docs.slice(0, MAX_VISITS_PER_ORDER)) workVisits.push(documentRecord(snapshot));
      }
      return reconcileProjectEvidence(project, { workOrders: [...workOrders.values()], workVisits, complete });
    }, { readOnly: true });
  };
}
module.exports = { createProjectReconciliationReader };
