'use strict';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error('Loopback emulators required.');
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Demo project only.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { createProjectRegistryService } = require('./registry-service');
const { captureLocalBackup, projectImportCandidate, STORAGE_KEYS } = require('./recovery');
const app = initializeApp({ projectId: PROJECT }, 'projects-history-tests');
const db = getFirestore(app); const auth = getAuth(app);
const options = { db, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true, allowLegacyImport: true };
const api = createProjectRegistryService(options); const actors = {}; let sequence = 0;
const next = () => `HISTORY-${++sequence}`;
const settings = db.collection('businessSettings').doc('projects-registry');
const sourceCollections = ['clients', 'properties', 'appointments', 'workOrders', 'workVisits', 'fieldOfficeReviews', 'projectLegacyImports', 'inventoryMovements', 'warehouseInventory', 'commercialProductStock', 'bookingCapacityLocks', 'whatsappOutboundQueue', 'invoices', 'payments'];
async function run(action, data, who = 'owner', requestId = next(), service = api) {
  return service.execute({ idToken: actors[who].token, command: { action, data, requestId } });
}
async function plan(id) { return (await run('get_plan', { projectId: id })).project; }
async function review(id) { return run('preview_history_reconciliation', { projectId: id }); }
function confirmation(view, extra = {}) { return { projectId: view.projectId, expectedVersion: view.projectVersion,
  previewDigest: view.digest, scopeConfirmed: true, acknowledgedLimitations: view.limitations, unlinkedNotes: [], reason: 'Verified synthetic scheduling-history references', ...extra }; }
async function snapshotSources() {
  const result = {};
  for (const name of sourceCollections) { const q = await db.collection(name).get(); result[name] = q.docs.map(s => [s.id, s.data()]).sort(([a], [b]) => a.localeCompare(b)); }
  return result;
}
async function fixture({ link = true, unknown = false, status = 'Active' } = {}) {
  const id = next(); const appointmentId = next(); const orderId = next(); const supportId = next();
  const raw = { id, projectNumber: `PRJ-${id}`, name: 'Synthetic imported history', customerId: 'H-CUSTOMER', siteId: 'H-PROPERTY',
    customerName: 'Synthetic', location: 'Synthetic', contactPerson: 'Synthetic', type: 'VRF Project', description: 'Synthetic scope',
    technicianInstructions: 'Synthetic instructions', status, priority: 'High', managerId: '', managerName: 'Not assigned',
    startsOn: '2026-09-01', estimatedCompletionOn: '2026-10-01', totalUnits: 8, completedUnits: 3, unitType: 'Units',
    estimatedWorkDays: 11, slotsPerWorkDay: 6, slotDurationMinutes: 60, estimatedSlots: 66, estimatedLaborHours: 66,
    actualLaborHours: 50, scheduledFutureHours: 69, materialBudget: 9000, materialActual: 100,
    assignedVans: [], phases: [], assignments: unknown ? [{ id: 'LOCAL-UNKNOWN', scheduledHours: 2 }] : [{ id: 'LOCAL-ONE', projectId: id, phaseId: '', appointmentId, workOrderId: orderId }], materials: [], expenses: [], costEntries: [] };
  await db.collection('appointments').doc(appointmentId).set({ customerId: 'H-CUSTOMER', propertyId: 'H-PROPERTY', status: 'confirmed', workOrderIds: [orderId, supportId] });
  for (const [wid, van] of [[orderId, 'VAN-PRIMARY'], [supportId, 'VAN-SUPPORT']]) {
    await db.collection('workOrders').doc(wid).set({ appointmentId, clientId: 'H-CUSTOMER', propertyId: 'H-PROPERTY', vanId: van, status: 'Confirmada', appointmentDurationMinutes: 180, scheduledSlots: 3 });
  }
  const file = JSON.stringify(await captureLocalBackup({ getItem: key => key === STORAGE_KEYS[0] ? JSON.stringify({ version: 1, projects: [raw] }) : '[]' }, { capturedAt: '2026-09-19T12:00:00.000Z', origin: 'https://erp.example.test' }));
  const candidate = await projectImportCandidate(file, id); const p = await run('preview_legacy_import', { candidate });
  await run('import_legacy_plan', { candidate, previewHash: p.previewHash, acknowledgedWarnings: p.warnings, backupConfirmed: true, reason: 'Retained synthetic original backup' });
  if (link && status !== 'Cancelled') await run('attach_existing_appointment', { projectId: id, expectedVersion: 1, appointmentId, phaseId: null, confirmedAssociation: true, reason: 'Verified explicit historical relation' });
  return { id, appointmentId, orderId, supportId, candidate, raw };
}
before(async () => {
  for (const [who, role] of [['owner', 'admin'], ['second', 'super_admin'], ['operations', 'operations'], ['finance', 'finance']]) {
    const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `history-${who}@example.test`, password: 'synthetic-history-password', returnSecureToken: true }) });
    const user = await res.json(); assert.ok(user.idToken); actors[who] = { uid: user.localId, token: user.idToken };
    await db.collection('users').doc(user.localId).set({ active: true, role });
  }
  await settings.set({ backendEnabled: true, legacyImportEnabled: true });
  await db.collection('clients').doc('H-CUSTOMER').set({ active: true });
  await db.collection('properties').doc('H-PROPERTY').set({ active: true, clientId: 'H-CUSTOMER' });
  for (const name of sourceCollections) await db.collection(name).doc('H-PROTECTED').set({ sentinel: name });
});
after(async () => { await deleteApp(app); });
test('import, association, preview and finalization preserve real-authority source records', async () => {
  const f = await fixture(); const before = await snapshotSources(); const old = await plan(f.id);
  const a = await review(f.id); const b = await review(f.id); assert.equal(a.digest, b.digest); assert.equal(a.linkedWorkOrders, 2); assert.equal(a.canFinalize, true);
  assert.equal((await plan(f.id)).migration.status, 'pending_reconciliation');
  await run('finalize_history_reconciliation', confirmation(a)); const p = await plan(f.id);
  assert.equal(p.migration.status, 'history_reviewed'); assert.equal(p.migration.historyReview.archivedActualsCertified, false);
  assert.deepEqual(p.budget, old.budget); assert.equal(p.planningStatus, old.planningStatus); assert.equal(p.actualLaborHours, undefined);
  assert.equal((await run('get_import_source', { projectId: f.id })).rawProjectJson, f.candidate.rawProjectJson);
  assert.deepEqual(await snapshotSources(), before);
  assert.equal((await run('get_activity', { projectId: f.id })).coverage.importReviewPending, false);
});
test('missing association fails until the original appointment is reviewed and linked', async () => {
  const f = await fixture({ link: false }); const view = await review(f.id); assert.equal(view.canFinalize, false);
  await assert.rejects(run('finalize_history_reconciliation', confirmation(view)), { code: 'history_reconciliation_not_ready' });
  await run('attach_existing_appointment', { projectId: f.id, expectedVersion: 1, appointmentId: f.appointmentId, phaseId: null, confirmedAssociation: true, reason: 'Link original record without new booking' });
  await run('finalize_history_reconciliation', confirmation(await review(f.id)));
});
test('missing support is blocking and is never replaced or silently discarded', async () => {
  const f = await fixture(); await db.collection('workOrders').doc(f.supportId).delete();
  const view = await review(f.id); assert.equal(view.canFinalize, false);
  await assert.rejects(run('finalize_history_reconciliation', confirmation(view)), { code: 'history_reconciliation_not_ready' });
});
test('stale source and stale Project versions fail without partial review', async () => {
  const f = await fixture(); const view = await review(f.id);
  await db.collection('workOrders').doc(f.supportId).update({ syntheticNote: 'Changed after preview' });
  await assert.rejects(run('finalize_history_reconciliation', confirmation(view)), { code: 'history_preview_changed' });
  const fresh = await review(f.id); await run('edit_metadata', { projectId: f.id, expectedVersion: fresh.projectVersion, patch: { description: 'Another operator' } });
  await assert.rejects(run('finalize_history_reconciliation', confirmation(fresh)), { code: 'version_conflict' });
  assert.equal((await plan(f.id)).migration.status, 'pending_reconciliation');
});
test('two owners racing produce one accepted revision and one conflict', async () => {
  const f = await fixture(); const data = confirmation(await review(f.id));
  const results = await Promise.allSettled([run('finalize_history_reconciliation', data), run('finalize_history_reconciliation', data, 'second')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'version_conflict').length, 1);
});
test('exact replay survives a write pause and cannot be reused for changed payload', async () => {
  const f = await fixture(); const data = confirmation(await review(f.id)); const key = next();
  const first = await run('finalize_history_reconciliation', data, 'owner', key); await settings.update({ writesPaused: true });
  try {
    const replay = await run('finalize_history_reconciliation', data, 'owner', key); assert.equal(replay.replayed, true); assert.equal(replay.version, first.version);
    await assert.rejects(run('finalize_history_reconciliation', { ...data, reason: 'Different' }, 'owner', key), { code: 'request_conflict' });
  } finally { await settings.update({ writesPaused: false }); }
});
test('only a currently authorized owner can view raw-history review or finalize it', async () => {
  const f = await fixture(); const data = confirmation(await review(f.id));
  for (const who of ['operations', 'finance']) {
    await assert.rejects(run('preview_history_reconciliation', { projectId: f.id }, who), { code: 'import_owner_required' });
    await assert.rejects(run('finalize_history_reconciliation', data, who), { code: who === 'finance' ? 'forbidden' : 'import_owner_required' });
  }
  await db.collection('users').doc(actors.second.uid).update({ active: false });
  try { await assert.rejects(run('finalize_history_reconciliation', data, 'second'), { code: 'forbidden' }); }
  finally { await db.collection('users').doc(actors.second.uid).update({ active: true }); }
});
test('unreferenced rows remain audited and unverified instead of becoming worked hours', async () => {
  const f = await fixture({ unknown: true }); const view = await review(f.id);
  await assert.rejects(run('finalize_history_reconciliation', confirmation(view)), { code: 'history_unlinked_review_required' });
  await run('finalize_history_reconciliation', confirmation(view, { unlinkedNotes: [{ index: 0, reason: 'No recoverable reference in this source; retained unverified' }] }));
  const p = await plan(f.id); const event = (await db.collection('projectEvents').doc(p.migration.historyReview.eventId).get()).data();
  assert.equal(event.historyReconciliation.unverifiedRows[0].status, 'archived_unverified'); assert.equal(p.actualLaborHours, undefined);
});
test('audit failure aborts migration metadata and receipt atomically', async () => {
  const f = await fixture(); const data = confirmation(await review(f.id)); const before = await plan(f.id); const key = next();
  const failing = { collection: (...args) => db.collection(...args), runTransaction: (fn, config) => db.runTransaction(tx => fn(new Proxy(tx, {
    get(target, prop) { if (prop === 'create') return (ref, value) => { if (ref.parent.id === 'projectEvents') throw Error('Injected history audit failure'); return target.create(ref, value); }; const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value; },
  })), config) };
  await assert.rejects(run('finalize_history_reconciliation', data, 'owner', key, createProjectRegistryService({ ...options, db: failing })), /Injected history audit failure/);
  assert.deepEqual(await plan(f.id), before);
  const retry = await run('finalize_history_reconciliation', data, 'owner', key); assert.equal(retry.replayed, false);
});
test('review of a cancelled imported source does not reopen it', async () => {
  const f = await fixture({ status: 'Cancelled', unknown: true }); const view = await review(f.id);
  await run('finalize_history_reconciliation', confirmation(view, { unlinkedNotes: [{ index: 0, reason: 'Retained cancelled source without an operational reference' }] }));
  assert.equal((await plan(f.id)).planningStatus, 'Cancelled');
});

async function material(f, id, patch = {}) {
  await db.collection('inventoryMovements').doc(id).set({ id, version: 1, workOrderId: f.orderId,
    type: 'issue_to_work_order', itemKind: 'material', itemId: 'PIPE', itemName: 'Synthetic pipe', quantity: 2.5,
    occurredAt: '2026-09-19T12:00:00.000Z', sourceLocationId: 'VAN-PRIMARY', ...patch });
}
test('material read uses canonical Inventory issues without changing stock, source or Project', async () => {
  const f = await fixture(); await material(f, next()); const before = await snapshotSources(); const p = await plan(f.id);
  const data = await run('get_materials', { projectId: f.id, workOrderId: f.orderId });
  assert.equal(data.rows.length, 1); assert.equal(data.rows[0].quantity, 2.5); assert.equal(data.rows[0].totalCost, null);
  assert.equal(data.coverage.wholeProjectTotal, false); assert.equal(data.costs.amount, null);
  assert.deepEqual(await plan(f.id), p); assert.deepEqual(await snapshotSources(), before);
});
test('materials are paginated with no duplicated or silently omitted issue IDs', async () => {
  const f = await fixture(); for (let i = 0; i < 43; i++) await material(f, `MOV-${f.id}-${String(i).padStart(2, '0')}`);
  const a = await run('get_materials', { projectId: f.id, workOrderId: f.orderId }); assert.equal(a.rows.length, 40); assert.ok(a.nextCursor);
  const b = await run('get_materials', { projectId: f.id, workOrderId: f.orderId, afterId: a.nextCursor }); assert.equal(b.rows.length, 3); assert.equal(b.nextCursor, null);
  assert.equal(new Set([...a.rows, ...b.rows].map(row => row.movementId)).size, 43);
});
test('material access cannot cross Project, Work Order or customer identity', async () => {
  const f = await fixture(); const other = await fixture();
  await assert.rejects(run('get_materials', { projectId: f.id, workOrderId: other.orderId }), { code: 'material_work_order_forbidden' });
  await db.collection('workOrders').doc(f.orderId).update({ customerId: 'FOREIGN' });
  await assert.rejects(run('get_materials', { projectId: f.id, workOrderId: f.orderId }), { code: 'material_work_order_forbidden' });
});
test('unsupported movement is disclosed as incomplete evidence, never a zero-cost project', async () => {
  const f = await fixture(); await material(f, next(), { type: 'unexpected_adjustment', quantity: 50 });
  const result = await run('get_materials', { projectId: f.id, workOrderId: f.orderId });
  assert.equal(result.coverage.pageValid, false); assert.equal(result.issues.length, 1); assert.equal(result.costs.amount, null);
});
