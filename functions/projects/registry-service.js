'use strict';
const d = require('./registry-domain');
const { loadProjectActivity } = require('./registry-activity');
const COLLECTIONS = Object.freeze({ records: 'projectRecords', numbers: 'projectNumbers', links: 'projectAppointmentLinks', events: 'projectEvents', receipts: 'projectCommandReceipts', settings: 'businessSettings' });
const WRITE_ACTIONS = new Set(['create_plan', 'edit_metadata', 'set_phases', 'revise_estimate', 'attach_existing_appointment']);
const READ_ACTIONS = new Set(['get_plan', 'list_plans', 'get_activity']);
const snapshotRecord = (snapshot) => snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
const MAX_APPOINTMENT_WORK_ORDERS = 60;

/** Not exported by bootstrap/index; creation requires explicit deployment AND server activation. */
function createProjectRegistryService({ db, verifyIdToken, enabled = false, clock = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.collection !== 'function' || typeof verifyIdToken !== 'function') throw new Error('Trusted Firestore and token verifier required.');
  function ref(collection, identifier) { return db.collection(collection).doc(identifier); }
  async function execute({ idToken, command }) {
    if (enabled !== true) throw d.fault('projects_not_active', 'Central Projects is not activated.', 503);
    if (typeof idToken !== 'string' || !idToken || idToken.length > 16000) throw d.fault('unauthenticated', 'Sign in to DEMAC ERP.', 401);
    let decoded;
    try { decoded = await verifyIdToken(idToken, true); d.id(decoded?.uid, 'authenticated user'); }
    catch { throw d.fault('unauthenticated', 'Sign in to DEMAC ERP.', 401); }
    d.allowedKeys(command, ['action', 'requestId', 'data'], ['action', 'data']);
    const serialized = d.canonical(command);
    if (Buffer.byteLength(serialized, 'utf8') > d.MAX_COMMAND_BYTES) throw d.fault('payload_too_large', 'Project command is too large.', 413);
    // Capture immutable input once. Mutating an object while a transaction retries cannot change intent.
    const input = JSON.parse(serialized);
    const write = WRITE_ACTIONS.has(input.action);
    if (!write && !READ_ACTIONS.has(input.action)) throw d.fault('unsupported_action', 'Projects action is not supported.');
    if (write && (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(input.requestId))) throw d.fault('invalid_request_id', 'A stable requestId is required.');
    const requestHash = d.digest(input);
    const commandId = write ? `PC-${d.digest(`${decoded.uid}:${input.requestId}`).slice(0, 40)}` : null;
    const occurredAt = d.stamp(clock());
    return db.runTransaction(async (transaction) => {
      const [profile, activation] = await transaction.getAll(ref('users', decoded.uid), ref(COLLECTIONS.settings, 'projects-registry'));
      const principal = d.actor(decoded.uid, snapshotRecord(profile), write);
      if (!activation.exists || activation.data().backendEnabled !== true) throw d.fault('projects_not_active', 'Central Projects is not activated.', 503);
      const receiptRef = write ? ref(COLLECTIONS.receipts, commandId) : null;
      if (receiptRef) {
        const receipt = snapshotRecord(await transaction.get(receiptRef));
        if (receipt) {
          if (receipt.actorId !== principal.uid || receipt.requestHash !== requestHash) throw d.fault('request_conflict', 'This requestId was already used for a different operation.', 409);
          return { ...receipt.result, replayed: true };
        }
      }
      const data = d.plain(input.data);
      if (input.action === 'list_plans') {
        d.allowedKeys(data, ['limit', 'afterId'], []);
        const limit = data.limit === undefined ? 30 : d.integer(data.limit, 'page limit', 1, 50);
        let query = db.collection(COLLECTIONS.records).orderBy('__name__');
        if (data.afterId !== undefined) query = query.startAfter(d.id(data.afterId));
        const snapshot = await transaction.get(query.limit(limit + 1));
        const rows = snapshot.docs.slice(0, limit).map(snapshotRecord).map(d.requireRecord);
        return { source: 'project_registry_v1', projects: rows, nextCursor: snapshot.docs.length > limit ? rows[rows.length - 1].id : null };
      }
      let project; let recordRef; let before; let next; let linkWrite = null; let numberWrite = null;
      if (input.action === 'create_plan') {
        const plan = d.normalizePlanInput(data);
        const projectId = `P-${d.digest(`${principal.uid}:${input.requestId}`).slice(0, 32)}`;
        const projectNumber = `PRJ-${projectId.slice(2, 18).toUpperCase()}`;
        recordRef = ref(COLLECTIONS.records, projectId);
        const numberRef = ref(COLLECTIONS.numbers, projectNumber);
        const [existing, number, client, property] = await transaction.getAll(recordRef, numberRef, ref('clients', plan.customerId), ref('properties', plan.propertyId));
        if (existing.exists || number.exists) throw d.fault('project_identity_conflict', 'Project identity already exists; use the original request or reconcile.', 409);
        assertCrm(client, property, plan.customerId);
        const { budgetedVanMinutes, ...fields } = plan;
        project = { ...fields, id: projectId, projectNumber, schemaVersion: d.SCHEMA_VERSION, version: 1, planningStatus: 'Planned', budget: { unit: 'van_minutes', originalMinutes: budgetedVanMinutes, currentMinutes: budgetedVanMinutes, revision: 1 }, createdAt: occurredAt, createdBy: principal.uid, updatedAt: occurredAt, updatedBy: principal.uid };
        next = project;
        numberWrite = { ref: numberRef, data: { projectId, createdAt: occurredAt } };
      } else {
        d.id(data.projectId, 'projectId');
        recordRef = ref(COLLECTIONS.records, data.projectId);
        project = d.requireRecord(snapshotRecord(await transaction.get(recordRef)));
        before = project;
        if (input.action === 'get_plan') {
          d.allowedKeys(data, ['projectId']);
          return { source: 'project_registry_v1', project };
        }
        if (input.action === 'get_activity') {
          d.allowedKeys(data, ['projectId', 'afterId'], ['projectId']);
          return loadProjectActivity({ db, transaction, project, afterId: data.afterId });
        }
        d.requireVersion(project, data.expectedVersion);
        if (input.action === 'edit_metadata') {
          d.allowedKeys(data, ['projectId', 'expectedVersion', 'patch']);
          next = { ...project, ...d.applyMetadata(project, data.patch) };
        } else if (input.action === 'revise_estimate') {
          d.allowedKeys(data, ['projectId', 'expectedVersion', 'budgetedVanMinutes', 'reason']);
          if (principal.role !== 'super_admin' && principal.role !== 'operations') throw d.fault('estimate_forbidden', 'Only the owner or Operations may revise an estimate.', 403);
          d.text(data.reason, 'estimate revision reason', 1000);
          const minutes = d.integer(data.budgetedVanMinutes, 'project estimate', 1);
          if (project.phases.reduce((sum, phase) => sum + phase.plannedVanMinutes, 0) > minutes) throw d.fault('phase_budget_allocation', 'Reconcile phase estimates before reducing the project planning baseline.');
          next = { ...project, budget: { ...project.budget, currentMinutes: minutes, revision: project.budget.revision + 1 } };
        } else if (input.action === 'set_phases') {
          d.allowedKeys(data, ['projectId', 'expectedVersion', 'phases']);
          const phases = d.normalizePhases(data.phases);
          if (phases.reduce((sum, phase) => sum + phase.plannedVanMinutes, 0) > project.budget.currentMinutes) throw d.fault('phase_budget_allocation', 'Phase estimates exceed the project planning baseline.');
          const wanted = new Set(phases.map((phase) => phase.id));
          const removed = project.phases.filter((phase) => !wanted.has(phase.id));
          // One existence read per changed/deleted phase, not a scan of all project activity.
          for (const phase of removed) {
            const linked = await transaction.get(db.collection(COLLECTIONS.links).where('projectId', '==', project.id).where('phaseId', '==', phase.id).limit(1));
            if (!linked.empty) throw d.fault('phase_has_history', 'A phase with linked operational history cannot be removed.', 409);
          }
          next = { ...project, phases };
        } else if (input.action === 'attach_existing_appointment') {
          d.allowedKeys(data, ['projectId', 'expectedVersion', 'appointmentId', 'phaseId', 'confirmedAssociation', 'reason']);
          if (data.confirmedAssociation !== true) throw d.fault('association_confirmation_required', 'Explicitly confirm the existing appointment association.');
          d.text(data.reason, 'association reason', 1000);
          const appointmentId = d.id(data.appointmentId, 'appointmentId');
          const phaseId = data.phaseId === null ? null : d.id(data.phaseId, 'phaseId');
          if (phaseId !== null && !project.phases.some((phase) => phase.id === phaseId)) throw d.fault('unknown_project_phase', 'The phase does not belong to this project.', 409);
          const linkRef = ref(COLLECTIONS.links, appointmentId);
          const [existingLink, appointmentSnapshot] = await transaction.getAll(linkRef, ref('appointments', appointmentId));
          const appointment = snapshotRecord(appointmentSnapshot);
          if (!appointment || appointment.customerId !== project.customerId || (appointment.clientId !== undefined && appointment.clientId !== project.customerId) || appointment.propertyId !== project.propertyId || (appointment.appointmentId && appointment.appointmentId !== appointmentId)) throw d.fault('appointment_identity_conflict', 'The appointment must match the project Customer and Property.', 409);
          if (existingLink.exists && (existingLink.data().projectId !== project.id || existingLink.data().phaseId !== phaseId)) throw d.fault('association_conflict', 'This appointment is already linked to another project or phase.', 409);
          const orders = await transaction.get(db.collection('workOrders').where('appointmentId', '==', appointmentId).limit(MAX_APPOINTMENT_WORK_ORDERS + 1));
          if (!orders.docs.length || orders.docs.length > MAX_APPOINTMENT_WORK_ORDERS) throw d.fault('work_order_scope', 'Appointment Work Orders are missing or exceed this reconciliation scope.', 409);
          for (const item of orders.docs) {
            const order = item.data();
            if (order.clientId !== project.customerId || (order.customerId !== undefined && order.customerId !== project.customerId) || order.propertyId !== project.propertyId) throw d.fault('work_order_identity_conflict', 'A related Work Order has conflicting identity.', 409);
          }
          const actualOrderIds = new Set(orders.docs.map((order) => order.id));
          const expectedOrderIds = [...(Array.isArray(appointment.workOrderIds) ? appointment.workOrderIds : []), ...(appointment.workOrderId ? [appointment.workOrderId] : [])];
          if (expectedOrderIds.some((id) => !actualOrderIds.has(id))) throw d.fault('work_order_missing', 'An appointment Work Order is missing. Reconcile before linking.', 409);
          // Relation only; capacity, statuses, messages, visit actuals and stock are never written here.
          linkWrite = existingLink.exists ? null : { ref: linkRef, data: { schemaVersion: 1, appointmentId, projectId: project.id, phaseId, customerId: project.customerId, propertyId: project.propertyId, source: 'explicit_reconciliation', reason: data.reason.trim(), workOrderIdsAtLink: orders.docs.map((order) => order.id).sort(), createdAt: occurredAt, createdBy: principal.uid } };
          next = existingLink.exists ? project : { ...project };
        }
      }
      if (!next) throw d.fault('unsupported_action', 'No Project mutation was resolved.', 500);
      const changed = input.action === 'create_plan' || next !== before;
      if (before && changed) next = { ...next, version: before.version + 1, updatedAt: occurredAt, updatedBy: principal.uid };
      const result = { success: true, projectId: next.id, version: next.version, changed, ...(input.action === 'attach_existing_appointment' ? { appointmentId: data.appointmentId, linked: true } : {}) };
      // All reads above; all writes below. No side effects in retryable transaction callbacks.
      if (input.action === 'create_plan') transaction.create(recordRef, next);
      else if (changed) transaction.set(recordRef, next);
      if (numberWrite) transaction.create(numberWrite.ref, numberWrite.data);
      if (linkWrite) transaction.create(linkWrite.ref, linkWrite.data);
      if (changed) transaction.create(ref(COLLECTIONS.events, commandId), { schemaVersion: 1, action: input.action, actorId: principal.uid, actorRole: principal.role, projectId: next.id, requestHash, occurredAt, beforeVersion: before?.version || 0, afterVersion: next.version, beforePlan: before || null, afterPlan: next, ...(input.action === 'revise_estimate' ? { beforeBudget: before.budget, afterBudget: next.budget, reason: data.reason.trim() } : {}), ...(input.action === 'attach_existing_appointment' ? { appointmentId: data.appointmentId, phaseId: data.phaseId } : {}) });
      transaction.create(receiptRef, { actorId: principal.uid, requestHash, projectId: next.id, occurredAt, result });
      return { ...result, replayed: false };
    }, write ? { maxAttempts: 5 } : { readOnly: true });
  }
  return { execute };
}
function assertCrm(client, property, customerId) {
  if (!client.exists || client.data().active === false || !property.exists || property.data().active === false || property.data().clientId !== customerId) throw d.fault('crm_identity_conflict', 'Choose an existing active Customer and its Service Property.', 409);
}
module.exports = { COLLECTIONS, createProjectRegistryService };
