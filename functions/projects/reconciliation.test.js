'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileProjectEvidence } = require('./reconciliation');
const { createProjectReconciliationReader } = require('./reconciliation-reader');

function fixture() {
  const project = {
    id: 'P-TEST', customerId: 'C-TEST', siteId: 'PROP-TEST', estimatedLaborHours: 12,
    phases: [{ id: 'PH-TEST' }],
    assignments: [{ projectId: 'P-TEST', workOrderId: 'WO-TEST', appointmentId: 'A-TEST', phaseId: 'PH-TEST', scheduledHours: 999, actualHours: 999 }],
  };
  const order = { id: 'WO-TEST', appointmentId: 'A-TEST', clientId: 'C-TEST', propertyId: 'PROP-TEST', vanId: 'V-TEST', scheduledSlots: 3, appointmentDurationMinutes: 150, status: 'Confirmada', date: '2026-09-01' };
  const visit = { id: 'VISIT-TEST', workOrderId: order.id, appointmentId: order.appointmentId, clientId: order.clientId, propertyId: order.propertyId, status: 'in_progress', startedAt: '2026-09-01T13:00:00.000Z' };
  return { project, order, visit };
}
function report(f = fixture(), extra = {}) {
  return reconcileProjectEvidence(f.project, { workOrders: [f.order], workVisits: [f.visit], complete: true, ...extra });
}
function has(result, code) { return result.issues.some((issue) => issue.code === code); }

test('canonical planned duration and slots remain separate; never adopt browser actuals', () => {
  const result = report();
  assert.equal(result.allocationEvidence.recordedPlannedMinutes, 150);
  assert.equal(result.allocationEvidence.recordedSlots, 3);
  assert.equal(result.actualLaborHours, null);
  assert.equal(result.physicalCompletionPercent, null);
  assert.equal(result.canApply, false);
  assert.equal(result.status, 'review_required');
});
test('no input is mutated; retries produce the same report, not cumulative counters', () => {
  const f = fixture(); const before = JSON.stringify(f);
  assert.deepEqual(report(f), report(f)); assert.equal(JSON.stringify(f), before);
});
test('identical repeated source rows and local links count once', () => {
  const f = fixture(); f.project.assignments.push({ ...f.project.assignments[0] });
  const result = report(f, { workOrders: [f.order, { ...f.order }], workVisits: [f.visit, { ...f.visit }] });
  assert.equal(result.allocationEvidence.recordedSlots, 3);
  assert.equal(result.allocationEvidence.matchedWorkVisits, 1);
});
test('different versions of the same source identity block totals', () => {
  const f = fixture();
  const result = report(f, { workOrders: [f.order, { ...f.order, scheduledSlots: 5 }] });
  assert.equal(result.status, 'blocked'); assert.equal(result.allocationEvidence.recordedSlots, null);
  assert.ok(has(result, 'conflicting_source_versions'));
});
test('unlinked support Work Orders are review candidates, not silently charged to a phase', () => {
  const f = fixture(); const support = { ...f.order, id: 'WO-SUPPORT', vanId: 'V-SUPPORT' };
  const result = report(f, { workOrders: [f.order, support] });
  assert.equal(result.allocationEvidence.recordedSlots, 3);
  assert.equal(result.allocationEvidence.relatedCandidateOrders, 1);
  assert.equal(result.workOrders.find((row) => row.workOrderId === support.id).phaseId, null);
});
test('explicitly linked multiple vans are each counted once', () => {
  const f = fixture(); const support = { ...f.order, id: 'WO-SUPPORT', vanId: 'V-SUPPORT' };
  f.project.assignments.push({ ...f.project.assignments[0], workOrderId: support.id });
  const result = report(f, { workOrders: [f.order, support] });
  assert.equal(result.allocationEvidence.recordedSlots, 6);
  assert.equal(result.allocationEvidence.recordedPlannedMinutes, 300);
});
test('general project work is not lost when there are no phases', () => {
  const f = fixture(); f.project.phases = []; f.project.assignments[0].phaseId = '';
  const result = report(f);
  assert.equal(result.workOrders[0].phaseId, 'GENERAL-PROJECT-WORK');
  assert.equal(result.allocationEvidence.recordedSlots, 3);
});
test('general work remains visible if phases were created later', () => {
  const f = fixture(); f.project.assignments[0].phaseId = 'GENERAL-PROJECT-WORK';
  assert.equal(report(f).allocationEvidence.recordedSlots, 3);
});
test('missing phase and contradictory local links block automatic conclusions', () => {
  const f = fixture(); f.project.assignments[0].phaseId = 'PH-MISSING';
  assert.ok(has(report(f), 'unknown_project_phase'));
  f.project.assignments.push({ ...f.project.assignments[0], phaseId: 'PH-OTHER' });
  assert.ok(has(report(f), 'conflicting_local_links'));
});
test('wrong Customer, Property or Appointment cannot be matched by name', () => {
  for (const field of ['clientId', 'propertyId', 'appointmentId']) {
    const f = fixture(); f.order[field] = 'UNRELATED';
    const result = report(f);
    assert.ok(has(result, 'work_order_identity_conflict'));
    assert.equal(result.allocationEvidence.recordedSlots, null);
  }
});
test('conflicting customer aliases and wrong visit identity block totals', () => {
  const f = fixture(); f.visit.customerId = 'UNRELATED';
  assert.ok(has(report(f), 'work_visit_identity_conflict'));
});
test('partial source reads are unavailable, not a misleading zero', () => {
  const result = report(fixture(), { complete: false });
  assert.equal(result.allocationEvidence.recordedSlots, null);
  assert.ok(has(result, 'incomplete_source_read'));
});
test('cancelled order capacity is excluded without deleting visit history', () => {
  const f = fixture(); f.order.status = 'Cancelada';
  const result = report(f);
  assert.equal(result.allocationEvidence.recordedSlots, 0);
  assert.equal(result.allocationEvidence.excludedCancelledOrders, 1);
  assert.equal(result.allocationEvidence.matchedWorkVisits, 1);
});
test('a reprogrammed order uses its current snapshot, not old local slots', () => {
  const f = fixture(); f.order.scheduledSlots = 4; f.order.appointmentDurationMinutes = 210; f.order.date = '2026-09-03';
  const result = report(f);
  assert.equal(result.allocationEvidence.recordedSlots, 4);
  assert.equal(result.workOrders[0].date, '2026-09-03');
});
test('missing Work Order remains an explicit reconciliation blocker', () => {
  assert.ok(has(report(fixture(), { workOrders: [] }), 'linked_work_order_missing'));
});
test('missing visit does not mean a worker did zero hours', () => {
  const result = report(fixture(), { workVisits: [] });
  assert.ok(has(result, 'no_work_visit_found')); assert.equal(result.actualLaborHours, null);
});
test('unknown status, invalid duration and invalid slots fail closed', () => {
  for (const [field, value] of [['status', 'NewUnknownStatus'], ['appointmentDurationMinutes', -1], ['scheduledSlots', 0.5]]) {
    const f = fixture(); f.order[field] = value;
    assert.ok(has(report(f), 'unresolved_scheduling_evidence'));
  }
});
test('multiple return visits preserve distinct evidence, not duplicate parent allocation', () => {
  const f = fixture(); const result = report(f, { workVisits: [f.visit, { ...f.visit, id: 'RETURN-TEST', status: 'completed' }] });
  assert.equal(result.allocationEvidence.recordedSlots, 3);
  assert.equal(result.allocationEvidence.visitsWithExecutionEvidence, 2);
  assert.equal(result.actualLaborHours, null);
});

function readDb(f = fixture(), user = { active: true, role: 'super_admin' }, additions = {}) {
  const data = {
    users: { 'USER-TEST': user }, workOrders: { [f.order.id]: f.order }, workVisits: { [f.visit.id]: f.visit }, ...additions,
  };
  const reads = [];
  const snapshot = (id, value) => ({ id, exists: value !== undefined && value !== null, data: () => structuredClone(value) });
  return {
    reads,
    collection(name) { return {
      doc(id) { return { name, id }; },
      where(field, op, value) { assert.equal(op, '=='); return { limit(limit) { return { name, field, value, limit }; } }; },
    }; },
    async runTransaction(callback, options) {
      assert.deepEqual(options, { readOnly: true });
      return callback({
        async get(ref) {
          reads.push(ref);
          if (ref.id) return snapshot(ref.id, data[ref.name]?.[ref.id]);
          assert.ok(ref.field && ref.limit <= 51, 'Queries must be bounded and scoped');
          return { docs: Object.entries(data[ref.name] ?? {}).filter(([, row]) => row[ref.field] === ref.value).slice(0, ref.limit).map(([id, value]) => snapshot(id, value)) };
        },
        set() { assert.fail('No writes'); }, update() { assert.fail('No writes'); }, delete() { assert.fail('No deletes'); },
      });
    },
  };
}
const verifyIdToken = async (token, revoked) => { assert.equal(token, 'TEST-TOKEN'); assert.equal(revoked, true); return { uid: 'USER-TEST' }; };
test('reader verifies revocation and provisioned owner inside a read-only transaction', async () => {
  const f = fixture(); const db = readDb(f);
  const read = createProjectReconciliationReader({ db, verifyIdToken });
  const result = await read({ idToken: 'TEST-TOKEN', project: f.project });
  assert.equal(result.allocationEvidence.matchedWorkVisits, 1);
  assert.equal(db.reads[0].name, 'users');
  assert.ok(db.reads.every((ref) => ['users', 'workOrders', 'workVisits'].includes(ref.name)));
});
test('inactive, absent and unauthorized users cannot query operational records', async () => {
  for (const user of [null, { role: 'super_admin', active: false }, { role: 'office_operator', active: true }, { role: 'technician', active: true }]) {
    const db = readDb(fixture(), user);
    const read = createProjectReconciliationReader({ db, verifyIdToken });
    await assert.rejects(read({ idToken: 'TEST-TOKEN', project: fixture().project }), { code: 'forbidden' });
    assert.equal(db.reads.length, 1);
  }
});
test('expired token fails before any Firestore read; token role claims cannot grant access', async () => {
  const db = readDb();
  const read = createProjectReconciliationReader({ db, verifyIdToken: async () => { throw new Error('expired'); } });
  await assert.rejects(read({ idToken: 'expired', project: fixture().project }), { code: 'unauthenticated' });
  assert.equal(db.reads.length, 0);
  const deniedDb = readDb(fixture(), { role: 'technician', active: true });
  const denied = createProjectReconciliationReader({ db: deniedDb, verifyIdToken: async () => ({ uid: 'USER-TEST', role: 'super_admin' }) });
  await assert.rejects(denied({ idToken: 'forged-role', project: fixture().project }), { code: 'forbidden' });
});
test('reader refuses an oversized requested scope and invalid document paths', async () => {
  const f = fixture(); f.project.assignments = Array.from({ length: 26 }, (_, i) => ({ workOrderId: `WO-${i}` }));
  const read = createProjectReconciliationReader({ db: readDb(), verifyIdToken });
  await assert.rejects(read({ idToken: 'TEST-TOKEN', project: f.project }), { code: 'scope_limit' });
  f.project.assignments = [{ workOrderId: 'collection/id' }];
  await assert.rejects(read({ idToken: 'TEST-TOKEN', project: f.project }), { code: 'invalid_local_link' });
});
test('query truncation is detected and never reported as complete', async () => {
  const f = fixture(); const workVisits = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`VISIT-${i}`, { ...f.visit, id: `VISIT-${i}` }]));
  const read = createProjectReconciliationReader({ db: readDb(f, undefined, { workVisits }), verifyIdToken });
  const result = await read({ idToken: 'TEST-TOKEN', project: f.project });
  assert.equal(result.sourceReadComplete, false); assert.equal(result.allocationEvidence.recordedSlots, null);
});
test('document identity overrides embedded ID and reader does not fetch unrelated visits', async () => {
  const f = fixture(); const bad = { ...f.order, id: 'embedded-wrong', clientId: 'OTHER' };
  const db = readDb(f, undefined, { workOrders: { [f.order.id]: bad } });
  const read = createProjectReconciliationReader({ db, verifyIdToken });
  const result = await read({ idToken: 'TEST-TOKEN', project: f.project });
  assert.ok(has(result, 'work_order_identity_conflict'));
  assert.equal(db.reads.filter((ref) => ref.name === 'workVisits').length, 0);
});
test('unknown visit status and malformed start evidence cannot masquerade as measured work', () => {
  for (const patch of [{ status: 'new_unknown' }, { startedAt: 'not a timestamp' }]) {
    const f = fixture(); Object.assign(f.visit, patch);
    const result = report(f);
    assert.ok(has(result, 'unresolved_field_evidence'));
    assert.equal(result.allocationEvidence.recordedSlots, null);
    assert.equal(result.actualLaborHours, null);
  }
});
test('unrelated source records are not silently included in the project', () => {
  const f = fixture(); const other = { ...f.order, id: 'WO-OTHER', appointmentId: 'A-OTHER' };
  const result = report(f, { workOrders: [f.order, other] });
  assert.equal(result.workOrders.length, 1);
  assert.equal(result.allocationEvidence.recordedSlots, 3);
});
