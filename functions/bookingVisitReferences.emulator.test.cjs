const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createVisitReferenceService } = require('./bookingVisitReferences');
const projectId = 'demo-demac-booking-references';
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Local emulator required');
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Synthetic project required');
const app = initializeApp({ projectId }, 'reference-concurrency');
const db = getFirestore(app);
const now = new Date('2026-10-06T16:00:00Z');
const service = createVisitReferenceService({ db, clock: () => now });
const actor = { id: 'synthetic-office', source: 'office-scheduling' };
const appointment = { status: 'confirmed', date: '2026-10-06', customerId: 'synthetic-customer', propertyId: 'synthetic-property',
  startTime: '08:30', primaryVanId: 'VAN-1', workOrderIds: ['WO-1'], assignments: [{ vanId: 'VAN-1', slots: 2 }], lifecycleHistory: [{ operation: 'confirmed' }] };
const references = { notes: 'Reference only', location: null, files: [{ id: 'synthetic-file-1', description: 'Kitchen reference' }] };
const request = id => ({ appointmentId: 'APT-1', actor, expectedVersion: 0, requestId: id, references });
beforeEach(async () => {
  const cleared = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(cleared.ok);
  const batch = db.batch();
  for (const [key, value] of Object.entries({
    'users/synthetic-office': { active: true, role: 'office' },
    'appointments/APT-1': appointment, 'appointments/APT-2': appointment,
    'workOrders/WO-1': { appointmentId: 'APT-1', vanId: 'VAN-1', time: '08:30', status: 'Confirmada', plannedUnits: 2 },
    'bookingCapacityLocks/synthetic-lock': { appointmentId: 'APT-1', vanId: 'VAN-1', active: true },
    'bookingReferenceUploads/synthetic-file-1': { uploadedBy: actor.id, status: 'ready', expiresAt: '2026-10-07T16:00:00Z',
      storagePath: `booking-references/${actor.id}/synthetic-file-1`, fileName: 'kitchen.jpg', kind: 'image', mimeType: 'image/jpeg', size: 3 },
  })) batch.set(db.doc(key), value);
  await batch.commit();
});
after(async () => { await db.terminate(); await deleteApp(app); });
test('concurrent reference edits commit once and leave real scheduling fields and capacity untouched', async () => {
  const originalOrder = (await db.doc('workOrders/WO-1').get()).data();
  const originalLock = (await db.doc('bookingCapacityLocks/synthetic-lock').get()).data();
  const results = await Promise.allSettled([service.save(request('edit-request-one')), service.save({ ...request('edit-request-two'), references: { ...references, notes: 'Competing operator' } })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const saved = (await db.doc('appointments/APT-1').get()).data();
  const { visitReferences, ...schedule } = saved;
  assert.deepEqual(schedule, appointment);
  assert.equal(visitReferences.version, 1);
  assert.deepEqual((await db.doc('workOrders/WO-1').get()).data(), originalOrder);
  assert.deepEqual((await db.doc('bookingCapacityLocks/synthetic-lock').get()).data(), originalLock);
  assert.equal((await db.collection('appointments/APT-1/referenceChanges').get()).size, 1);
});
test('one staged file cannot be claimed by two bookings under a real Firestore race', async () => {
  const results = await Promise.allSettled([service.save(request('claim-request-one')), service.save({ ...request('claim-request-two'), appointmentId: 'APT-2' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const owner = (await db.doc('bookingReferenceUploads/synthetic-file-1').get()).data().appointmentId;
  assert.ok(['APT-1', 'APT-2'].includes(owner));
  const loser = owner === 'APT-1' ? 'APT-2' : 'APT-1';
  assert.deepEqual((await db.doc('appointments/' + loser).get()).data(), appointment);
});
test('an existing scheduling edit is preserved when reference save retries its transaction', async () => {
  await Promise.all([
    service.save(request('preserve-schedule-edit')),
    db.doc('appointments/APT-1').set({ primaryVanId: 'VAN-2', startTime: '14:30', assignments: [{ vanId: 'VAN-2', slots: 2 }] }, { merge: true }),
  ]);
  const saved = (await db.doc('appointments/APT-1').get()).data();
  assert.equal(saved.primaryVanId, 'VAN-2'); assert.equal(saved.startTime, '14:30');
  assert.equal(saved.visitReferences.version, 1);
  const replay = await service.save(request('preserve-schedule-edit'));
  assert.equal(replay.replayed, true);
  assert.deepEqual((await db.doc('appointments/APT-1').get()).data(), saved);
});
