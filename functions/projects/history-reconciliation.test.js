'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./registry-domain');
const h = require('./history-reconciliation');
function fixture(assignments = [{ appointmentId: 'A-ONE', workOrderId: 'W-ONE', phaseId: '' }]) {
  const project = { id: 'P-ONE', customerId: 'C-ONE', propertyId: 'S-ONE', projectNumber: 'PRJ-ONE', version: 3,
    schemaVersion: 1, phases: [], planningStatus: 'Planned', budget: { unit: 'van_minutes', originalMinutes: 60, currentMinutes: 60, revision: 1 } };
  const source = { rawProjectJson: JSON.stringify({ id: project.id, customerId: project.customerId, siteId: project.propertyId,
    projectNumber: project.projectNumber, assignments, actualLaborHours: 99 }), source: { backupDigest: 'b'.repeat(64) } };
  project.migration = { status: 'pending_reconciliation', importId: 'IMPORT-ONE', sourceDigest: d.digest(source), capturedBaselineOnly: true };
  const docs = new Map([
    ['projectLegacyImports/IMPORT-ONE', { ...source, projectId: project.id, sourceDigest: project.migration.sourceDigest }],
    ['clients/C-ONE', { active: true }], ['properties/S-ONE', { active: true, clientId: 'C-ONE' }],
    ['appointments/A-ONE', { customerId: 'C-ONE', propertyId: 'S-ONE', workOrderIds: ['W-ONE', 'W-SUPPORT'], status: 'confirmed' }],
    ['projectAppointmentLinks/A-ONE', { schemaVersion: 1, appointmentId: 'A-ONE', projectId: 'P-ONE', customerId: 'C-ONE', propertyId: 'S-ONE', phaseId: null, workOrderIdsAtLink: ['W-ONE', 'W-SUPPORT'] }],
    ['workOrders/W-ONE', { appointmentId: 'A-ONE', clientId: 'C-ONE', propertyId: 'S-ONE', secretDescription: 'PRIVATE' }],
    ['workOrders/W-SUPPORT', { appointmentId: 'A-ONE', clientId: 'C-ONE', propertyId: 'S-ONE' }],
  ]);
  const revisions = new Map(); const reads = [];
  const snap = path => ({ ref: { path }, id: path.split('/')[1], exists: docs.has(path), data: () => structuredClone(docs.get(path)), updateTime: { seconds: 1, nanoseconds: revisions.get(path) || 0 } });
  const query = (name, clauses = [], limit = 1000) => ({ name, clauses, maximum: limit,
    where(field, op, value) { return query(name, [...clauses, [field, op, value]], limit); },
    orderBy(field) { assert.equal(field, '__name__'); return this; }, limit(n) { return query(name, clauses, n); },
    doc(id) { return { path: `${name}/${id}` }; } });
  const db = { collection: name => query(name) };
  const transaction = { getAll: async (...refs) => { assert.ok(refs.length <= 50); reads.push(...refs.map(ref => ref.path)); return refs.map(ref => snap(ref.path)); },
    get: async ref => {
      reads.push(ref.path || `${ref.name}:query`);
      if (ref.path) return snap(ref.path);
      assert.ok(ref.maximum <= 251);
      const rows = [...docs].filter(([path, value]) => path.startsWith(`${ref.name}/`) && ref.clauses.every(([field, op, wanted]) => op === 'in' ? wanted.includes(value[field]) : value[field] === wanted));
      return { docs: rows.sort(([a], [b]) => a.localeCompare(b)).slice(0, ref.maximum).map(([path]) => snap(path)) };
    }, set() { assert.fail('No source writes'); }, create() { assert.fail('No source writes'); } };
  const args = { db, transaction, project, principal: { uid: 'OWNER', role: 'super_admin' }, occurredAt: '2026-09-20T00:00:00.000Z', eventId: 'EVENT-ONE' };
  return { ...args, docs, reads, revisions, preview: () => h.previewHistoryReconciliation(args), args };
}
function command(view, extra = {}) { return { data: { projectId: view.projectId, expectedVersion: view.projectVersion,
  previewDigest: view.digest, scopeConfirmed: true, acknowledgedLimitations: [...h.LIMITATIONS], unlinkedNotes: [], reason: 'Reviewed original scheduling evidence', ...extra } }; }
test('read-only preview includes primary and support Work Orders once and exposes no content or actuals', async () => {
  const f = fixture(); const before = [...f.docs]; const a = await f.preview(); const b = await f.preview();
  assert.equal(a.canFinalize, true); assert.equal(a.linkedAppointments, 1); assert.equal(a.linkedWorkOrders, 2); assert.equal(a.rows[0].status, 'verified_link');
  assert.equal(a.digest, b.digest); assert.equal(JSON.stringify(a).includes('PRIVATE'), false); assert.equal(a.actualLaborHours, undefined);
  assert.deepEqual([...f.docs], before); assert.ok(f.reads.every(path => !/workVisits|inventory|invoice/i.test(path)));
});
test('finalization changes only Project migration metadata, preserving estimate, lifecycle and archive', async () => {
  const f = fixture(); const original = structuredClone(f.project); const view = await f.preview();
  const result = await h.prepareHistoryReconciliation({ ...f.args, input: command(view) });
  assert.equal(result.next.migration.status, 'history_reviewed'); assert.equal(result.next.migration.sourceDigest, original.migration.sourceDigest);
  assert.deepEqual(result.next.budget, original.budget); assert.equal(result.next.planningStatus, original.planningStatus);
  assert.equal(result.next.actualLaborHours, undefined); assert.equal(result.evidence.archivedActualsCertified, false); assert.deepEqual(f.project, original);
});
test('current work link absence blocks approval instead of manufacturing an association', async () => {
  const f = fixture(); f.docs.delete('projectAppointmentLinks/A-ONE'); const view = await f.preview();
  assert.equal(view.canFinalize, false); assert.ok(view.blockers.some(row => row.code === 'source_appointment_not_associated'));
  await assert.rejects(h.prepareHistoryReconciliation({ ...f.args, input: command(view) }), { code: 'history_reconciliation_not_ready' });
});
test('a missing source Work Order cannot be excluded even when its appointment is linked', async () => {
  const f = fixture(); f.docs.delete('workOrders/W-ONE'); const view = await f.preview(); assert.equal(view.canFinalize, false);
  assert.ok(view.blockers.some(row => row.code === 'source_work_order_missing'));
});
test('a missing support Work Order blocks the entire appointment review', async () => {
  const f = fixture(); f.docs.delete('workOrders/W-SUPPORT'); const view = await f.preview(); assert.equal(view.canFinalize, false);
  assert.ok(view.blockers.some(row => row.code === 'linked_work_order_missing'));
});
test('conflicting source customer aliases are not matched by name or reassigned', async () => {
  const f = fixture(); f.docs.get('workOrders/W-ONE').customerId = 'OTHER'; const view = await f.preview(); assert.equal(view.canFinalize, false);
  assert.ok(view.blockers.some(row => row.code === 'source_work_order_identity_conflict'));
});
test('source phase mismatch remains blocking, including general versus phased work', async () => {
  const f = fixture([{ appointmentId: 'A-ONE', workOrderId: 'W-ONE', phaseId: 'PH-OLD' }]); const view = await f.preview();
  assert.equal(view.canFinalize, false); assert.equal(view.rows[0].status, 'source_phase_conflict');
});
test('unreferenced source rows require individual notes and remain explicitly unverified', async () => {
  const f = fixture([{}, {}]); const view = await f.preview(); assert.deepEqual(view.unlinkedIndexes, [0, 1]);
  await assert.rejects(h.prepareHistoryReconciliation({ ...f.args, input: command(view) }), { code: 'history_unlinked_review_required' });
  const out = await h.prepareHistoryReconciliation({ ...f.args, input: command(view, { unlinkedNotes: [{ index: 0, reason: 'No external reference exists in this source' }, { index: 1, reason: 'Archived without certified execution' }] }) });
  assert.equal(out.evidence.hasUnverifiedSourceRows, true); assert.equal(out.evidence.unverifiedRows[1].status, 'archived_unverified');
});
test('duplicate note indexes, omitted acknowledgement and implicit confirmation are rejected', async () => {
  const f = fixture([{}, {}]); const view = await f.preview();
  for (const extra of [{ scopeConfirmed: false }, { acknowledgedLimitations: [] }, { unlinkedNotes: [{ index: 0, reason: 'one' }, { index: 0, reason: 'again' }] }]) {
    await assert.rejects(h.prepareHistoryReconciliation({ ...f.args, input: command(view, extra) }));
  }
});
test('source version changes invalidate the preview including sub-millisecond precision', async () => {
  const f = fixture(); const view = await f.preview(); f.revisions.set('workOrders/W-SUPPORT', 1);
  await assert.rejects(h.prepareHistoryReconciliation({ ...f.args, input: command(view) }), { code: 'history_preview_changed' });
});
test('new current links after preview change its digest', async () => {
  const f = fixture(); const view = await f.preview(); f.docs.set('projectAppointmentLinks/A-TWO', { ...f.docs.get('projectAppointmentLinks/A-ONE'), appointmentId: 'A-TWO', workOrderIdsAtLink: ['W-TWO'] });
  f.docs.set('appointments/A-TWO', { ...f.docs.get('appointments/A-ONE'), workOrderIds: ['W-TWO'] }); f.docs.set('workOrders/W-TWO', { ...f.docs.get('workOrders/W-ONE'), appointmentId: 'A-TWO' });
  await assert.rejects(h.prepareHistoryReconciliation({ ...f.args, input: command(view) }), { code: 'history_preview_changed' });
});
test('archive corruption or foreign project identity fails before certifying references', async () => {
  const f = fixture(); f.docs.get('projectLegacyImports/IMPORT-ONE').rawProjectJson = '{}';
  await assert.rejects(f.preview(), { code: 'import_archive_conflict' });
  assert.throws(() => h.sourceReferences({ id: 'OTHER', assignments: [] }, f.project), { code: 'history_source_conflict' });
});
test('non-owner reader and writer are rejected', async () => {
  const f = fixture(); await assert.rejects(h.previewHistoryReconciliation({ ...f.args, principal: { uid: 'OPERATOR', role: 'operations' } }), { code: 'import_owner_required' });
});
test('source without an appointment reference resolves through its canonical Work Order', async () => {
  const f = fixture([{ workOrderId: 'W-ONE' }]); const view = await f.preview(); assert.equal(view.canFinalize, true); assert.equal(view.rows[0].resolvedAppointmentId, 'A-ONE');
});
test('oversized history and source references fail instead of pretending to be complete', async () => {
  const f = fixture(); for (let i = 0; i < 101; i++) f.docs.set(`projectAppointmentLinks/OVER-${i}`, { projectId: f.project.id });
  await assert.rejects(f.preview(), { code: 'history_scope_limit' });
  assert.throws(() => h.sourceReferences({ id: f.project.id, customerId: f.project.customerId, siteId: f.project.propertyId, projectNumber: f.project.projectNumber, assignments: Array(251).fill({}) }, f.project), { code: 'history_source_conflict' });
});
test('reviewed history remains readable and cannot be finalized a second time', async () => {
  const f = fixture(); f.project.migration.status = 'history_reviewed'; const view = await f.preview();
  assert.equal(view.alreadyReviewed, true); assert.equal(view.canFinalize, false);
});
