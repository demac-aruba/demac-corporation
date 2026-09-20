'use strict';
const d = require('./registry-domain');
const { loadProjectActivity } = require('./registry-activity');
const { loadProjectMaterials } = require('./registry-materials');
const { loadProjectExecution } = require('./registry-execution');
const { recordedPhaseReview, previewPhaseCompletion, preparePhaseCompletion } = require('./phase-completion');
const { previewPhaseProgress, preparePhaseProgress } = require('./phase-progress');
const { previewProjectLifecycle, prepareProjectLifecycle } = require('./project-lifecycle');
const { readTemplateLibrary, listTemplates, previewTemplateApplication, prepareTemplateCommand } = require('./phase-templates');
const { previewHistoryReconciliation, prepareHistoryReconciliation } = require('./history-reconciliation');
const { prepareImportTransaction, readImportSource } = require('./registry-import-transaction');
const COLLECTIONS = Object.freeze({ records: 'projectRecords', numbers: 'projectNumbers', links: 'projectAppointmentLinks', events: 'projectEvents', receipts: 'projectCommandReceipts', settings: 'businessSettings' });
const WRITE_ACTIONS = new Set(['create_plan', 'edit_metadata', 'set_phases', 'revise_estimate', 'attach_existing_appointment', 'import_legacy_plan', 'approve_phase_completion', 'reopen_phase', 'record_phase_progress', 'transition_project_status', 'save_phase_template', 'apply_phase_template', 'set_phase_template_active', 'finalize_history_reconciliation']);
const READ_ACTIONS = new Set(['get_plan', 'list_plans', 'get_activity', 'get_execution', 'get_phase_completion', 'get_phase_progress', 'preview_project_status', 'list_phase_templates', 'preview_phase_template', 'preview_legacy_import', 'get_import_source', 'preview_history_reconciliation', 'get_materials']);
const snapshotRecord = (snapshot) => snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
const MAX_APPOINTMENT_WORK_ORDERS = 60;

/** Planning authority; the deployment adapter defaults off and requires server activation. */
function createProjectRegistryService({ db, verifyIdToken, enabled = false, allowLegacyImport = false, clock = () => new Date().toISOString() } = {}) {
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
      if (['preview_legacy_import', 'import_legacy_plan', 'get_import_source', 'preview_history_reconciliation', 'finalize_history_reconciliation'].includes(input.action) && principal.role !== 'super_admin') throw d.fault('import_owner_required', 'Owner authorization is required for legacy recovery.', 403);
      if (input.action === 'import_legacy_plan' && (allowLegacyImport !== true || activation.data().legacyImportEnabled !== true)) throw d.fault('legacy_import_not_active', 'Legacy import is not activated. Preview is read-only.', 503);
      const receiptRef = write ? ref(COLLECTIONS.receipts, commandId) : null;
      if (receiptRef) {
        const receipt = snapshotRecord(await transaction.get(receiptRef));
        if (receipt) {
          if (receipt.actorId !== principal.uid || receipt.requestHash !== requestHash) throw d.fault('request_conflict', 'This requestId was already used for a different operation.', 409);
          return { ...receipt.result, replayed: true };
        }
      }
      // Operational rollback can stop NEW writes while retaining central reads and exact receipts.
      // This flag is server-only; ordinary Project forms cannot modify it.
      if (activation.data().writesPaused !== undefined && typeof activation.data().writesPaused !== 'boolean') {
        throw d.fault('project_settings_conflict', 'The Project write-control setting requires review.', 503);
      }
      if (write && activation.data().writesPaused === true) {
        throw d.fault('projects_writes_paused', 'New Project changes are paused. Existing records and completed-request recovery remain available.', 503);
      }
      const data = d.plain(input.data);
      if (input.action === 'list_phase_templates') {
        d.allowedKeys(data, []);
        return listTemplates((await readTemplateLibrary({ db, transaction })).library);
      }
      if (input.action === 'list_plans') {
        d.allowedKeys(data, ['limit', 'afterId'], []);
        const limit = data.limit === undefined ? 30 : d.integer(data.limit, 'page limit', 1, 50);
        let query = db.collection(COLLECTIONS.records).orderBy('__name__');
        if (data.afterId !== undefined) query = query.startAfter(d.id(data.afterId));
        const snapshot = await transaction.get(query.limit(limit + 1));
        const rows = snapshot.docs.slice(0, limit).map(snapshotRecord).map(d.requireRecord);
        return { source: 'project_registry_v1', writeMode: activation.data().writesPaused === true ? 'paused' : 'enabled', projects: rows, nextCursor: snapshot.docs.length > limit ? rows[rows.length - 1].id : null };
      }
      let project; let recordRef; let before; let next; let linkWrite = null; let numberWrite = null; let archiveWrite = null; let importAudit = null; let phaseCompletion = null; let phaseProgress = null; let lifecycle = null; let templateEvidence = null; let templateWrite = null; let historyReconciliation = null;
      if (input.action === 'preview_legacy_import' || input.action === 'import_legacy_plan') {
        const prepared = await prepareImportTransaction({ db, transaction, input, principal, occurredAt, collections: COLLECTIONS });
        if (prepared.preview) return prepared.preview;
        ({ recordRef, next, numberWrite, archiveWrite, importAudit } = prepared);
      } else if (input.action === 'create_plan') {
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
        if (input.action === 'get_import_source') {
          d.allowedKeys(data, ['projectId']);
          return readImportSource({ db, transaction, project, principal });
        }
        if (input.action === 'preview_history_reconciliation') {
          d.allowedKeys(data, ['projectId']);
          return previewHistoryReconciliation({ db, transaction, project, principal });
        }
        if (input.action === 'preview_phase_template') {
          return previewTemplateApplication({ db, transaction, project, data });
        }
        if (input.action === 'get_phase_progress') {
          d.allowedKeys(data, ['projectId', 'phaseId']);
          return previewPhaseProgress({ db, transaction, project, phaseId: data.phaseId });
        }
        if (input.action === 'preview_project_status') {
          d.allowedKeys(data, ['projectId', 'targetStatus']);
          return previewProjectLifecycle({ db, transaction, project, targetStatus: data.targetStatus });
        }
        if (input.action === 'get_phase_completion') {
          d.allowedKeys(data, ['projectId', 'phaseId']);
          return previewPhaseCompletion({ db, transaction, project, phaseId: data.phaseId });
        }
        if (input.action === 'get_materials') {
          d.allowedKeys(data, ['projectId', 'workOrderId', 'afterId'], ['projectId', 'workOrderId']);
          return loadProjectMaterials({ db, transaction, project, workOrderId: data.workOrderId, afterId: data.afterId });
        }
        if (input.action === 'get_execution') {
          d.allowedKeys(data, ['projectId', 'afterId'], ['projectId']);
          return loadProjectExecution({ db, transaction, project, afterId: data.afterId });
        }
        if (input.action === 'get_activity') {
          d.allowedKeys(data, ['projectId', 'afterId'], ['projectId']);
          return loadProjectActivity({ db, transaction, project, afterId: data.afterId });
        }
        d.requireVersion(project, data.expectedVersion);
        if (project.version >= Number.MAX_SAFE_INTEGER - 1) throw d.fault('project_version_exhausted', 'The project revision cannot advance safely.', 409);
        if (['Completed', 'Cancelled'].includes(project.planningStatus) && !['transition_project_status', 'save_phase_template', 'set_phase_template_active', 'finalize_history_reconciliation'].includes(input.action)) {
          throw d.fault('project_closed', 'Explicitly reopen the Project before changing its planning or scope records.', 409);
        }
        if (['save_phase_template', 'apply_phase_template', 'set_phase_template_active'].includes(input.action)) {
          const prepared = await prepareTemplateCommand({ db, transaction, project, input, principal, occurredAt, eventId: commandId });
          next = prepared.next; templateEvidence = prepared.evidence; templateWrite = prepared.settingsWrite;
        } else if (input.action === 'finalize_history_reconciliation') {
          const prepared = await prepareHistoryReconciliation({ db, transaction, project, input, principal, occurredAt, eventId: commandId });
          next = prepared.next; historyReconciliation = prepared.evidence;
        } else if (input.action === 'record_phase_progress') {
          const prepared = await preparePhaseProgress({ db, transaction, project, input, principal, occurredAt, eventId: commandId });
          next = prepared.next; phaseProgress = prepared.evidence;
        } else if (input.action === 'transition_project_status') {
          const prepared = await prepareProjectLifecycle({ db, transaction, project, input, principal, occurredAt, eventId: commandId });
          next = prepared.next; lifecycle = prepared.evidence;
        } else if (['approve_phase_completion', 'reopen_phase'].includes(input.action)) {
          const prepared = await preparePhaseCompletion({ db, transaction, project, input, principal, occurredAt, eventId: commandId });
          next = prepared.next; phaseCompletion = prepared.evidence;
        } else if (input.action === 'edit_metadata') {
          d.allowedKeys(data, ['projectId', 'expectedVersion', 'patch']);
          next = { ...project, ...d.applyMetadata(project, data.patch) };
        } else if (input.action === 'revise_estimate') {
          d.allowedKeys(data, ['projectId', 'expectedVersion', 'budgetedVanMinutes', 'reason']);
          d.text(data.reason, 'estimate revision reason', 1000);
          const minutes = d.integer(data.budgetedVanMinutes, 'project estimate', 1);
          if (project.budget.revision >= Number.MAX_SAFE_INTEGER - 1) throw d.fault('budget_revision_exhausted', 'The budget revision cannot advance safely.', 409);
          if (project.phases.reduce((sum, phase) => sum + phase.plannedVanMinutes, 0) > minutes) throw d.fault('phase_budget_allocation', 'Reconcile phase estimates before reducing the project planning baseline.');
          next = { ...project, budget: { ...project.budget, currentMinutes: minutes, revision: project.budget.revision + 1 } };
        } else if (input.action === 'set_phases') {
          d.allowedKeys(data, ['projectId', 'expectedVersion', 'phases']);
          const phases = d.normalizePhases(data.phases);
          if (phases.reduce((sum, phase) => sum + phase.plannedVanMinutes, 0) > project.budget.currentMinutes) throw d.fault('phase_budget_allocation', 'Phase estimates exceed the project planning baseline.');
          const wanted = new Set(phases.map((phase) => phase.id));
          const removed = project.phases.filter((phase) => !wanted.has(phase.id));
          if (removed.some(phase => recordedPhaseReview(project, phase.id))) throw d.fault('phase_has_history', 'A phase with scope approval history cannot be removed.', 409);
          // Bounded existence checks, batched across changed phases rather than N per-row reads.
          for (let offset = 0; offset < removed.length; offset += 10) {
            const phaseIds = removed.slice(offset, offset + 10).map((phase) => phase.id);
            const linked = await transaction.get(db.collection(COLLECTIONS.links).where('projectId', '==', project.id).where('phaseId', 'in', phaseIds).limit(1));
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
          if (!existingLink.exists && phaseId !== null && recordedPhaseReview(project, phaseId)?.status === 'approved') throw d.fault('project_phase_closed', 'Reopen the phase before adding another appointment.', 409);
          // Relation only; capacity, statuses, messages, visit actuals and stock are never written here.
          linkWrite = existingLink.exists ? null : { ref: linkRef, data: { schemaVersion: 1, appointmentId, projectId: project.id, phaseId, customerId: project.customerId, propertyId: project.propertyId, source: 'explicit_reconciliation', reason: data.reason.trim(), workOrderIdsAtLink: orders.docs.map((order) => order.id).sort(), createdAt: occurredAt, createdBy: principal.uid } };
          next = existingLink.exists ? project : { ...project };
        }
      }
      if (!next) throw d.fault('unsupported_action', 'No Project mutation was resolved.', 500);
      const createsRecord = ['create_plan', 'import_legacy_plan'].includes(input.action);
      const changed = createsRecord || next !== before;
      if (before && changed) next = { ...next, version: before.version + 1, updatedAt: occurredAt, updatedBy: principal.uid };
      const result = { success: true, projectId: next.id, version: next.version, changed, ...(input.action === 'attach_existing_appointment' ? { appointmentId: data.appointmentId, linked: true } : {}) };
      // All reads above; all writes below. No side effects in retryable transaction callbacks.
      if (createsRecord) transaction.create(recordRef, next);
      else if (changed) transaction.set(recordRef, next);
      if (numberWrite) transaction.create(numberWrite.ref, numberWrite.data);
      if (linkWrite) transaction.create(linkWrite.ref, linkWrite.data);
      if (archiveWrite) transaction.create(archiveWrite.ref, archiveWrite.data);
      if (templateWrite) transaction.set(templateWrite.ref, templateWrite.data);
      if (changed) transaction.create(ref(COLLECTIONS.events, commandId), { schemaVersion: 1, action: input.action, actorId: principal.uid, actorRole: principal.role, projectId: next.id, requestHash, occurredAt, beforeVersion: before?.version || 0, afterVersion: next.version, beforePlan: before || null, afterPlan: next, ...(importAudit ? { import: importAudit } : {}), ...(phaseCompletion ? { phaseCompletion } : {}), ...(phaseProgress ? { phaseProgress } : {}), ...(lifecycle ? { lifecycle } : {}), ...(templateEvidence ? { template: templateEvidence } : {}), ...(historyReconciliation ? { historyReconciliation } : {}), ...(input.action === 'revise_estimate' ? { beforeBudget: before.budget, afterBudget: next.budget, reason: data.reason.trim() } : {}), ...(input.action === 'attach_existing_appointment' ? { appointmentId: data.appointmentId, phaseId: data.phaseId } : {}) });
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
