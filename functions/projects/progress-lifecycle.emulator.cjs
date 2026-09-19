'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
for (const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name] || '')) throw Error('Loopback emulators required.');
}
const PROJECT = 'demo-demac-projects';
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Synthetic emulator data only.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { createProjectRegistryService } = require('./registry-service');
const { requirePhasePrerequisites } = require('./phase-completion');
const { officeReviewDocumentId, officeReviewRevisionDocumentId } = require('../fieldOperationsOfficeReview');
const app = initializeApp({ projectId: PROJECT }, 'progress-lifecycle-tests'); const db = getFirestore(app); const auth = getAuth(app);
const service = createProjectRegistryService({ db, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true });
const actors = {}; let seq = 0;
const stamp = '2026-09-19T12:00:00.000Z';
const base = { name: 'Synthetic progress project', type: 'VRF Project', customerId: 'PROGRESS-CUSTOMER', propertyId: 'PROGRESS-PROPERTY',
  startsOn: '2026-09-01', estimatedCompletionOn: '2026-10-01', budgetedVanMinutes: 60 };
const phase = { id: 'PH-A', name: 'Phase A', scopeOfWork: 'Synthetic scope', completionCriteria: 'Reviewed all units',
  plannedVanMinutes: 30, dependencies: [], progressMethod: 'units', unitsPlanned: 10,
  checklist: [{ id: 'CL-A', label: 'Checked', required: true }] };
async function run(action, data, who = 'admin', requestId = `PROGRESS-REQUEST-${++seq}`, target = service) {
  return target.execute({ idToken: actors[who].token, command: { action, data, requestId } });
}
async function read(id) { return (await run('get_plan', { projectId: id })).project; }
async function preview(id) { return run('get_phase_progress', { projectId: id, phaseId: 'PH-A' }); }
const progressValue = n => ({ completedUnits: n, checklistIds: n ? ['CL-A'] : [] });
async function record(id, n, options = {}) {
  const view = options.preview || await preview(id);
  return run('record_phase_progress', { projectId: id, phaseId: 'PH-A', expectedVersion: view.projectVersion,
    previewDigest: view.digest, progress: progressValue(n), reason: 'Reviewed synthetic cumulative scope',
    ...(options.correctsEventId ? { correctsEventId: options.correctsEventId } : {}) }, options.who, options.key, options.service);
}
async function lifecycle(id, targetStatus, patch = {}, who = 'admin', key) {
  const view = await run('preview_project_status', { projectId: id, targetStatus });
  return run('transition_project_status', { projectId: id, expectedVersion: view.projectVersion, targetStatus,
    previewDigest: view.digest, reason: 'Reviewed explicit synthetic lifecycle change', scopeConfirmed: true,
    reopeningConfirmed: true, ...patch }, who, key);
}
async function approvePhase(id) {
  const view = await run('get_phase_completion', { projectId: id, phaseId: 'PH-A' });
  return run('approve_phase_completion', { projectId: id, phaseId: 'PH-A', expectedVersion: view.projectVersion,
    previewDigest: view.digest, reason: 'Verified synthetic phase closure',
    confirmation: { criteriaConfirmed: true, verifiedUnits: 10, checklistIds: ['CL-A'] } });
}
async function fixture({ phases = true, approved = true, pendingSupport = false } = {}) {
  const plan = await run('create_plan', { ...base, phases: phases ? [phase] : [] });
  const appointmentId = `PROGRESS-APT-${++seq}`;
  const ids = [`PROGRESS-WO-${seq}`, ...(pendingSupport ? [`PROGRESS-SUPPORT-${seq}`] : [])];
  await db.collection('appointments').doc(appointmentId).set({ appointmentId, customerId: base.customerId, propertyId: base.propertyId, status: 'confirmed', workOrderIds: ids });
  for (const id of ids) {
    const complete = approved && id === ids[0];
    await db.collection('workOrders').doc(id).set({ appointmentId, clientId: base.customerId, propertyId: base.propertyId,
      status: complete ? 'Completada' : 'Confirmada', appointmentDurationMinutes: 360, scheduledSlots: 6,
      vanId: id === ids[0] ? 'VAN-A' : 'VAN-B', date: '2026-09-19', time: '08:30' });
    const visitId = `VISIT-${id}`;
    await db.collection('workVisits').doc(visitId).set({ id: visitId, workOrderId: id, appointmentId,
      clientId: base.customerId, propertyId: base.propertyId, status: complete ? 'completed' : 'scheduled', version: 2,
      ...(complete ? { startedAt: stamp, completedAt: '2026-09-19T14:00:00.000Z' } : {}) });
    if (complete) {
      const identity = { workOrderId: id, appointmentId, clientId: base.customerId, propertyId: base.propertyId, visitId };
      const reviewId = officeReviewDocumentId(id); const revisionId = officeReviewRevisionDocumentId(reviewId, 1);
      await db.collection('fieldOfficeReviews').doc(reviewId).set({ fieldAuthorityVersion: 1, ...identity, status: 'approved',
        currentRevisionId: revisionId, currentRevisionNumber: 1, submittedAt: stamp, submittedBy: 'SYNTHETIC-TECH',
        reviewedAt: stamp, reviewedBy: 'SYNTHETIC-REVIEWER', createdAt: stamp, createdBy: 'SYNTHETIC-TECH', updatedAt: stamp, version: 2 });
      await db.collection('fieldOfficeReviewRevisions').doc(revisionId).set({ fieldAuthorityVersion: 1, ...identity,
        reviewId, revisionNumber: 1, sourceVisitVersion: 2, submittedAt: stamp, submittedBy: 'SYNTHETIC-TECH',
        requestId: 'SYNTHETIC-REVIEW-REQUEST', snapshot: {}, version: 1 });
    }
  }
  await run('attach_existing_appointment', { projectId: plan.projectId, expectedVersion: 1, appointmentId,
    phaseId: phases ? 'PH-A' : null, confirmedAssociation: true, reason: 'Synthetic reconciled association' });
  return { id: plan.projectId, ids, appointmentId };
}
const protectedCollections = ['clients','properties','appointments','workOrders','workVisits','fieldOfficeReviews','fieldOfficeReviewRevisions',
  'bookingCapacityLocks','warehouseInventory','whatsappOutboundQueue','invoices','payments'];
async function protectedState() {
  const out = {};
  for (const name of protectedCollections) { const values = await db.collection(name).get(); out[name] = values.docs.map(row => [row.id, row.data()]).sort((a,b) => a[0].localeCompare(b[0])); }
  return out;
}
before(async () => {
  for (const [who, role] of [['admin','admin'],['operations','operations'],['finance','finance'],['technician','technician']]) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `progress-${who}@example.test`, password: 'synthetic-progress-tests', returnSecureToken: true }),
    });
    const user = await response.json(); assert.ok(user.idToken); actors[who] = { uid: user.localId, token: user.idToken };
    await db.collection('users').doc(user.localId).set({ role, active: true });
  }
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true });
  await db.collection('clients').doc(base.customerId).set({ active: true });
  await db.collection('properties').doc(base.propertyId).set({ active: true, clientId: base.customerId });
});
after(() => deleteApp(app));

test('approved partial work supports a checkpoint while other visits remain open', async () => {
  const f = await fixture({ pendingSupport: true }); const before = await protectedState(); const p = await preview(f.id);
  assert.equal(p.canRecord, true); assert.equal(p.sources.length, 1); await record(f.id, 4, { preview: p });
  const next = await preview(f.id); assert.equal(next.previous.progress.completedUnits, 4); assert.equal(next.previous.measure.percent, 40);
  assert.equal((await read(f.id)).phaseReviews[0].status, 'progress_recorded');
  const completion = await run('get_phase_completion', { projectId: f.id, phaseId: 'PH-A' }); assert.equal(completion.canApprove, false);
  assert.deepEqual(await protectedState(), before);
});
test('cumulative update and exact retry never add physical units twice', async () => {
  const f = await fixture(); const p = await preview(f.id); const key = `PROGRESS-EXACT-${++seq}`;
  const first = await record(f.id, 3, { preview: p, key }); const replay = await record(f.id, 3, { preview: p, key });
  assert.equal(replay.replayed, true); assert.equal(replay.version, first.version);
  await record(f.id, 5); const view = await preview(f.id); assert.equal(view.previous.progress.completedUnits, 5);
  assert.equal(view.previous.measure.percent, 50); assert.equal((await read(f.id)).actualLaborHours, undefined);
});
test('reducing a checkpoint requires the exact prior reference and preserves its audit', async () => {
  const f = await fixture(); await record(f.id, 6); const prior = await preview(f.id);
  await assert.rejects(record(f.id, 2, { preview: prior }), { code: 'phase_correction_reference_required' });
  await record(f.id, 2, { preview: prior, correctsEventId: prior.previous.eventId });
  assert.equal((await preview(f.id)).previous.progress.completedUnits, 2);
  const oldEvent = await db.collection('projectEvents').doc(prior.previous.eventId).get();
  assert.equal(oldEvent.data().phaseProgress.progress.completedUnits, 6);
});
test('stale source or stale Project versions cannot certify progress', async () => {
  const f = await fixture(); const p = await preview(f.id);
  await db.collection('workOrders').doc(f.ids[0]).update({ note: 'Source changed after preview' });
  await assert.rejects(record(f.id, 4, { preview: p }), { code: 'phase_preview_changed' });
  const fresh = await preview(f.id); await run('edit_metadata', { projectId: f.id, expectedVersion: 2, patch: { description: 'Other operator' } });
  await assert.rejects(record(f.id, 4, { preview: fresh }), { code: 'version_conflict' });
});
test('changed sources invalidate freshness rather than silently keeping a verified percentage', async () => {
  const f = await fixture(); await record(f.id, 7);
  await db.collection('workOrders').doc(f.ids[0]).update({ note: 'Updated source' });
  const p = await preview(f.id); assert.equal(p.previous.current, false); assert.equal(p.previous.progress.completedUnits, 7);
});
test('Finance and field-only roles cannot write progress or Project status', async () => {
  const f = await fixture();
  for (const who of ['finance', 'technician']) {
    await assert.rejects(record(f.id, 4, { who }), { code: 'forbidden' });
    await assert.rejects(lifecycle(f.id, 'Active', {}, who), { code: 'forbidden' });
  }
});
test('concurrent progress updates yield one accepted version and one explicit conflict', async () => {
  const f = await fixture(); const p = await preview(f.id);
  const values = await Promise.allSettled([record(f.id, 4, { preview: p }), record(f.id, 5, { preview: p, who: 'operations' })]);
  assert.equal(values.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(values.filter(row => row.status === 'rejected' && row.reason.code === 'version_conflict').length, 1);
});
test('100 percent checkpoint does not complete a phase or Project automatically', async () => {
  const f = await fixture(); await record(f.id, 10);
  assert.equal((await read(f.id)).planningStatus, 'Planned');
  await assert.rejects(lifecycle(f.id, 'Completed'), { code: 'project_lifecycle_not_ready' });
  await approvePhase(f.id); await lifecycle(f.id, 'Completed'); assert.equal((await read(f.id)).planningStatus, 'Completed');
});
test('closing requires explicit confirmation even with all current approvals', async () => {
  const f = await fixture({ phases: false });
  await assert.rejects(lifecycle(f.id, 'Completed', { scopeConfirmed: false }), { code: 'project_completion_confirmation_required' });
  await lifecycle(f.id, 'Completed'); const closed = await read(f.id); assert.equal(closed.budget.currentMinutes, 60);
  await assert.rejects(run('edit_metadata', { projectId: f.id, expectedVersion: closed.version, patch: { name: 'Not allowed' } }), { code: 'project_closed' });
});
test('open bookings prevent cancellation and are never silently cancelled by Projects', async () => {
  const f = await fixture({ approved: false }); const before = await protectedState();
  await assert.rejects(lifecycle(f.id, 'Cancelled'), { code: 'project_lifecycle_not_ready' });
  await lifecycle(f.id, 'On Hold'); assert.equal((await read(f.id)).planningStatus, 'On Hold');
  assert.deepEqual(await protectedState(), before);
});
test('project reopening preserves closure event and does not alter existing bookings', async () => {
  const f = await fixture({ phases: false }); const before = await protectedState(); await lifecycle(f.id, 'Completed');
  const closed = await read(f.id);
  await assert.rejects(lifecycle(f.id, 'Active', { reopeningConfirmed: false }), { code: 'project_reopen_confirmation_required' });
  await lifecycle(f.id, 'Active'); const active = await read(f.id); assert.equal(active.planningStatus, 'Active');
  assert.equal((await db.collection('projectEvents').doc(closed.lifecycleReview.eventId).get()).exists, true);
  assert.deepEqual(await protectedState(), before);
});
test('write interruption before audit creation leaves no partial checkpoint or lifecycle change', async () => {
  const f = await fixture();
  const failingDb = { collection: (...args) => db.collection(...args), runTransaction: (fn, options) => db.runTransaction(tx => fn(new Proxy(tx, {
    get(target, key) { if (key === 'create') return (ref, data) => { if (ref.parent.id === 'projectEvents') throw Error('Injected audit failure'); return target.create(ref, data); };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; },
  })), options) };
  const failing = createProjectRegistryService({ db: failingDb, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true });
  await assert.rejects(record(f.id, 5, { service: failing }), /Injected audit failure/);
  assert.equal((await read(f.id)).phaseReviews, undefined); assert.equal((await read(f.id)).version, 2);
});

async function templates() { return run('list_phase_templates', {}); }
async function saveTemplate(id, name = 'Synthetic company template', patch = {}) {
  const project = await read(id); const library = await templates();
  return run('save_phase_template', { projectId: id, expectedVersion: project.version,
    expectedLibraryVersion: library.libraryVersion, templateId: null, name, description: 'Reusable synthetic scope',
    replacementConfirmed: false, reason: 'Save an optional generic template', ...patch });
}
test('shared template copies planning only and preserves a reviewed source Project', async () => {
  const f = await fixture(); await record(f.id, 4); const source = await read(f.id); const before = await protectedState();
  await saveTemplate(f.id); const library = await templates(); const entry = library.templates.at(-1);
  assert.equal(entry.phaseCount, 1); assert.equal(entry.plannedVanMinutes, 30);
  const stored = (await db.collection('businessSettings').doc('projects-phase-templates').get()).data().templates.find(row => row.id === entry.id);
  assert.equal(stored.customerId, undefined); assert.equal(stored.phaseReviews, undefined);
  assert.deepEqual((await read(f.id)).phaseReviews, source.phaseReviews); assert.deepEqual(await protectedState(), before);
});
test('template application appends fresh phases and exact retry does not append twice', async () => {
  const source = await fixture(); await saveTemplate(source.id); const template = (await templates()).templates.at(-1);
  const target = await run('create_plan', { ...base, phases: [] }); const project = await read(target.projectId);
  const p = await run('preview_phase_template', { projectId: project.id, templateId: template.id, expectedTemplateVersion: template.version });
  const data = { projectId: project.id, expectedVersion: project.version, templateId: template.id, expectedTemplateVersion: template.version,
    previewDigest: p.digest, reason: 'Apply the reviewed generic plan' };
  const key = `APPLY-TEMPLATE-${++seq}`; await run('apply_phase_template', data, 'admin', key);
  const replay = await run('apply_phase_template', data, 'admin', key); assert.equal(replay.replayed, true);
  const current = await read(project.id); assert.equal(current.phases.length, 1); assert.notEqual(current.phases[0].id, 'PH-A');
  assert.notEqual(current.phases[0].checklist[0].id, 'CL-A'); assert.equal(current.phaseReviews, undefined);
  assert.equal(current.budget.originalMinutes, 60);
});
test('changing a library template cannot rewrite Projects that already applied it', async () => {
  const f = await fixture(); await saveTemplate(f.id); const old = (await templates()).templates.at(-1);
  await assert.rejects(saveTemplate(f.id, 'Replacement', { templateId: old.id }), { code: 'template_replace_confirmation_required' });
  const before = await read(f.id);
  await saveTemplate(f.id, 'Replacement', { templateId: old.id, replacementConfirmed: true });
  const after = await read(f.id); assert.deepEqual(after.phases, before.phases);
  assert.equal((await templates()).templates.find(row => row.id === old.id).version, 2);
});
test('template deactivation is reversible, audited and refuses stale application', async () => {
  const f = await fixture(); await saveTemplate(f.id); const library = await templates(); const template = library.templates.at(-1);
  const p = await read(f.id); await run('set_phase_template_active', { projectId: f.id, expectedVersion: p.version,
    expectedLibraryVersion: library.libraryVersion, templateId: template.id, active: false, reason: 'Archive old template' });
  await assert.rejects(run('preview_phase_template', { projectId: f.id, templateId: template.id, expectedTemplateVersion: 1 }), { code: 'template_not_available' });
  const next = await read(f.id); const archived = await templates();
  await run('set_phase_template_active', { projectId: f.id, expectedVersion: next.version, expectedLibraryVersion: archived.libraryVersion,
    templateId: template.id, active: true, reason: 'Restore the reusable template' });
  assert.equal((await templates()).templates.find(row => row.id === template.id).active, true);
});
test('rollback write-pause keeps central reads and original receipt recovery available', async () => {
  const f = await fixture(); const view = await preview(f.id); const key = `PAUSE-RECEIPT-${++seq}`;
  const first = await record(f.id, 4, { preview: view, key }); const before = await protectedState();
  await db.collection('businessSettings').doc('projects-registry').update({ writesPaused: true });
  try {
    assert.equal((await run('list_plans', {})).writeMode, 'paused');
    assert.equal((await read(f.id)).version, first.version);
    const replay = await record(f.id, 4, { preview: view, key }); assert.equal(replay.replayed, true);
    await assert.rejects(record(f.id, 5), { code: 'projects_writes_paused' });
    assert.equal((await preview(f.id)).previous.progress.completedUnits, 4); assert.deepEqual(await protectedState(), before);
  } finally { await db.collection('businessSettings').doc('projects-registry').update({ writesPaused: false }); }
});
