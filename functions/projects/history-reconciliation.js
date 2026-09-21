'use strict';
// Reconciles archived scheduling references, not money, time, physical progress or backups.
// The caller owns authentication/version/receipt/audit; this module never writes a source.
const d = require('./registry-domain');
const { readImportSource } = require('./registry-import-transaction');
const MAX_LINKS = 100;
const MAX_ORDERS = 250;
const LIMITATIONS = Object.freeze([
  'archived_actuals_not_certified',
  'backup_restore_not_certified',
  'review_covers_saved_source_and_current_links_only',
]);
const snapshotData = s => s.exists ? { ...s.data(), id: s.id } : null;
function proof(snapshot) {
  if (!snapshot.exists) return { path: snapshot.ref.path, exists: false };
  const at = snapshot.updateTime;
  if (!at || !Number.isSafeInteger(at.seconds) || !Number.isSafeInteger(at.nanoseconds)) {
    throw d.fault('source_version_missing', 'A source version is unavailable. Review again.', 409);
  }
  return { path: snapshot.ref.path, exists: true, seconds: at.seconds, nanoseconds: at.nanoseconds };
}
function sameIdentity(value, project) {
  return value && (value.clientId ?? value.customerId) === project.customerId
    && (value.clientId === undefined || value.clientId === project.customerId)
    && (value.customerId === undefined || value.customerId === project.customerId)
    && value.propertyId === project.propertyId;
}
function sourceReferences(raw, project) {
  if (raw.id !== project.id || raw.customerId !== project.customerId || raw.siteId !== project.propertyId
      || raw.projectNumber !== project.projectNumber || !Array.isArray(raw.assignments) || raw.assignments.length > 250) {
    throw d.fault('history_source_conflict', 'Archived and central Project identities disagree.', 409);
  }
  return raw.assignments.map((row, index) => {
    d.plain(row, 'archived assignment');
    if (row.projectId !== undefined && row.projectId !== project.id) throw d.fault('history_source_conflict', 'An archived assignment belongs to another Project.', 409);
    const reference = name => row[name] === undefined || row[name] === '' || row[name] === null ? null : d.id(row[name], name);
    return { index, appointmentId: reference('appointmentId'), workOrderId: reference('workOrderId'), phaseId: reference('phaseId') };
  });
}
function checkAcknowledgements(data, view) {
  if (data.scopeConfirmed !== true) throw d.fault('history_confirmation_required', 'Review the saved source and all current links explicitly.');
  if (!Array.isArray(data.acknowledgedLimitations) || data.acknowledgedLimitations.length !== LIMITATIONS.length
      || new Set(data.acknowledgedLimitations).size !== LIMITATIONS.length
      || data.acknowledgedLimitations.some(code => !LIMITATIONS.includes(code))) {
    throw d.fault('history_limitations_required', 'Acknowledge every limit of this historical review.');
  }
  if (!Array.isArray(data.unlinkedNotes) || data.unlinkedNotes.length !== view.unlinkedIndexes.length) {
    throw d.fault('history_unlinked_review_required', 'Each source row without a reference requires an individual explanation.');
  }
  const seen = new Set();
  return data.unlinkedNotes.map(note => {
    d.allowedKeys(note, ['index', 'reason']);
    d.integer(note.index, 'source row index', 0, 249);
    if (!view.unlinkedIndexes.includes(note.index) || seen.has(note.index)) throw d.fault('history_unlinked_review_required', 'Review exactly the unlinked source rows; known references cannot be excluded.');
    seen.add(note.index);
    return { index: note.index, reason: d.text(note.reason, 'unverified source explanation', 1000), status: 'archived_unverified' };
  });
}
async function previewHistoryReconciliation({ db, transaction, project, principal }) {
  if (principal.role !== 'super_admin') throw d.fault('import_owner_required', 'Only the owner can reconcile imported history.', 403);
  if (!project.migration || !['pending_reconciliation', 'history_reviewed'].includes(project.migration.status)) {
    throw d.fault('history_review_not_applicable', 'This Project has no supported pending or reviewed import.', 409);
  }
  const recovered = await readImportSource({ db, transaction, project, principal });
  const raw = JSON.parse(recovered.rawProjectJson);
  const references = sourceReferences(raw, project);
  const versions = new Map();
  const observe = snapshot => { versions.set(snapshot.ref.path, proof(snapshot)); return snapshotData(snapshot); };
  const readMany = async (collection, ids) => {
    const result = new Map(); const unique = [...new Set(ids)];
    for (let offset = 0; offset < unique.length; offset += 50) {
      const snapshots = await transaction.getAll(...unique.slice(offset, offset + 50).map(id => db.collection(collection).doc(d.id(id))));
      for (const snapshot of snapshots) result.set(snapshot.id, observe(snapshot));
    }
    return result;
  };
  const [customer, property] = await transaction.getAll(db.collection('clients').doc(project.customerId), db.collection('properties').doc(project.propertyId));
  observe(customer); observe(property);
  if (!customer.exists || customer.data().active === false || !property.exists || property.data().active === false
      || property.data().clientId !== project.customerId) throw d.fault('crm_identity_conflict', 'Resolve the current Customer and Property before reviewing history.', 409);
  const linksSnapshot = await transaction.get(db.collection('projectAppointmentLinks').where('projectId', '==', project.id).orderBy('__name__').limit(MAX_LINKS + 1));
  if (linksSnapshot.docs.length > MAX_LINKS) throw d.fault('history_scope_limit', 'This review exceeds 100 linked appointments; use a reviewed staged reconciliation.', 409);
  const links = new Map();
  for (const snapshot of linksSnapshot.docs) {
    const link = observe(snapshot);
    if (link.schemaVersion !== 1 || link.id !== link.appointmentId || link.projectId !== project.id || !sameIdentity(link, project)
        || (link.phaseId !== null && !project.phases.some(p => p.id === link.phaseId))) {
      throw d.fault('project_link_conflict', 'A current link has conflicting identity. No automatic reassignment is allowed.', 409);
    }
    links.set(link.id, link);
  }
  const referencedOrders = await readMany('workOrders', references.map(row => row.workOrderId).filter(Boolean));
  const appointmentIds = [...new Set([...links.keys(), ...references.map(row => row.appointmentId).filter(Boolean),
    ...[...referencedOrders.values()].filter(order => sameIdentity(order, project)).map(order => d.id(order.appointmentId))])];
  if (appointmentIds.length > MAX_LINKS) throw d.fault('history_scope_limit', 'This review exceeds 100 referenced appointments.', 409);
  const appointments = await readMany('appointments', appointmentIds);
  const orders = new Map(referencedOrders);
  // Never read Field children, payroll, financial records or another customer's Work Orders.
  const eligible = [...appointments.values()].filter(app => sameIdentity(app, project)
    && (app.appointmentId === undefined || app.appointmentId === app.id)).map(app => app.id);
  for (let offset = 0; offset < eligible.length; offset += 10) {
    const remaining = MAX_ORDERS - [...orders.values()].filter(Boolean).length;
    const found = await transaction.get(db.collection('workOrders').where('appointmentId', 'in', eligible.slice(offset, offset + 10)).limit(MAX_ORDERS + 1));
    if (found.docs.length > MAX_ORDERS || remaining < 0) throw d.fault('history_scope_limit', 'Too many Work Orders for this review.', 409);
    for (const snapshot of found.docs) orders.set(snapshot.id, observe(snapshot));
    if ([...orders.values()].filter(Boolean).length > MAX_ORDERS) throw d.fault('history_scope_limit', 'Too many Work Orders for this review.', 409);
  }
  const blockers = [];
  for (const [id, link] of links) {
    const appointment = appointments.get(id);
    const linkedOrders = [...orders.values()].filter(order => order && order.appointmentId === id);
    if (!sameIdentity(appointment, project) || (appointment.appointmentId && appointment.appointmentId !== id)) blockers.push({ code: 'linked_appointment_identity_conflict', appointmentId: id });
    if (!linkedOrders.length || linkedOrders.some(order => !sameIdentity(order, project))) blockers.push({ code: 'linked_work_order_identity_conflict', appointmentId: id });
    const expected = [...(Array.isArray(appointment?.workOrderIds) ? appointment.workOrderIds : []), ...(appointment?.workOrderId ? [appointment.workOrderId] : []), ...(Array.isArray(link.workOrderIdsAtLink) ? link.workOrderIdsAtLink : [])];
    if (expected.some(orderId => !linkedOrders.some(order => order.id === orderId))) blockers.push({ code: 'linked_work_order_missing', appointmentId: id });
  }
  const rows = references.map(reference => {
    if (!reference.appointmentId && !reference.workOrderId) return { ...reference, status: 'unlinked_source' };
    const order = reference.workOrderId ? referencedOrders.get(reference.workOrderId) : null;
    const appointmentId = reference.appointmentId || (sameIdentity(order, project) ? order.appointmentId : null);
    const app = appointments.get(appointmentId); const link = links.get(appointmentId);
    let code = null;
    if (reference.workOrderId && !order) code = 'source_work_order_missing';
    else if (reference.workOrderId && (!sameIdentity(order, project) || order.appointmentId !== appointmentId)) code = 'source_work_order_identity_conflict';
    else if (!sameIdentity(app, project) || (app.appointmentId && app.appointmentId !== app.id)) code = 'source_appointment_identity_conflict';
    else if (!link) code = 'source_appointment_not_associated';
    else if (link.phaseId !== reference.phaseId) code = 'source_phase_conflict';
    if (code) blockers.push({ code, index: reference.index, appointmentId: appointmentId || null });
    return { ...reference, resolvedAppointmentId: appointmentId || null, status: code || 'verified_link' };
  });
  const evidence = [...versions.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { mode: 'history_reconciliation_preview', projectId: project.id, projectVersion: project.version,
    sourceDigest: project.migration.sourceDigest, canFinalize: project.migration.status === 'pending_reconciliation' && blockers.length === 0,
    alreadyReviewed: project.migration.status === 'history_reviewed', rows, blockers,
    unlinkedIndexes: rows.filter(row => row.status === 'unlinked_source').map(row => row.index),
    linkedAppointments: links.size, linkedWorkOrders: [...orders.values()].filter(order => order && links.has(order.appointmentId)).length,
    limitations: [...LIMITATIONS],
    digest: d.digest({ projectId: project.id, projectVersion: project.version, sourceDigest: project.migration.sourceDigest, evidence, rows }),
    evidence, effect: 'references_reviewed_only_no_actuals_or_status_inferred' };
}
async function prepareHistoryReconciliation(args) {
  const { project, input, principal, occurredAt, eventId } = args;
  d.allowedKeys(input.data, ['projectId', 'expectedVersion', 'previewDigest', 'scopeConfirmed', 'acknowledgedLimitations', 'unlinkedNotes', 'reason']);
  const preview = await previewHistoryReconciliation(args);
  if (!preview.canFinalize) throw d.fault('history_reconciliation_not_ready', 'Resolve every known source reference before finalizing this review.', 409);
  if (preview.digest !== input.data.previewDigest) throw d.fault('history_preview_changed', 'The source or its links changed. Review again.', 409);
  const unverified = checkAcknowledgements(input.data, preview);
  const reason = d.text(input.data.reason, 'history review reason', 1000);
  const review = { eventId, reviewedBy: principal.uid, reviewedAt: occurredAt, sourceDigest: project.migration.sourceDigest,
    archivedActualsCertified: false, hasUnverifiedSourceRows: unverified.length > 0 };
  return { next: { ...project, migration: { ...project.migration, status: 'history_reviewed', historyReview: review } },
    evidence: { ...review, previewDigest: preview.digest, sourceVersions: preview.evidence, rows: preview.rows,
      limitations: [...LIMITATIONS], unverifiedRows: unverified, reason, scopeConfirmed: true } };
}
module.exports = { LIMITATIONS, MAX_LINKS, sourceReferences, checkAcknowledgements, previewHistoryReconciliation, prepareHistoryReconciliation };
