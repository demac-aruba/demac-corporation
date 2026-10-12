const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { listScheduleHistory } = require('./bookingScheduleHistory');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8877') throw Error('Use the isolated history emulator on 127.0.0.1:8877 only.');
const app = initializeApp({ projectId: 'demo-demac-history' });
const db = getFirestore(app);
test.after(() => deleteApp(app));

test('real Firestore indexed pagination, tied timestamps, past origins and commit-time delta are read-only', async () => {
  const prefix = `HISTORY-${Date.now()}`;
  const at = '2026-01-01T12:00:00.000Z';
  const from = { dateKey: '2026-01-05', primaryVanId: 'VAN-1', primaryStart: '08:30', primaryEnd: '11:30' };
  const event = { id: 'E', kind: 'customer_reschedule', at, actorName: 'Synthetic operator', reason: 'Synthetic move', from, to: { ...from, dateKey: '2027-05-01' } };
  const tiedTimestamp = new Timestamp(Timestamp.now().seconds, 123456789);
  const batch = db.batch();
  for (let i = 0; i < 53; i++) batch.set(db.collection('appointments').doc(`${prefix}-${String(i).padStart(3, '0')}`), {
    customerId: 'SYNTHETIC', propertyId: 'SYNTHETIC', date: '2027-05-01', rescheduledAtIso: at,
    lifecycleHistory: [event], updatedAt: tiedTimestamp,
  });
  batch.set(db.collection('appointments').doc(`${prefix}-CANCEL`), {
    cancelledAtIso: at, lifecycleHistory: [{ ...event, id: 'C', kind: 'cancelled', to: null }], updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  const before = await db.collection('appointments').get();
  const storedTimestamp = before.docs.find(doc => doc.id === `${prefix}-000`).data().updatedAt;
  assert.notEqual(storedTimestamp.nanoseconds % 1e6, 0, 'Exercise precision below a JavaScript millisecond');
  const seen = new Set(); let cursor, result, pages = 0;
  do {
    result = await listScheduleHistory({ db, data: { cursor } }); cursor = result.nextCursor; pages++;
    result.appointments.forEach(item => { seen.add(item.appointmentId); assert.equal(item.events[0].from.dateKey, '2026-01-05'); });
  } while (cursor);
  assert.equal(seen.size, 54); assert.equal(pages, 3);
  const after = await db.collection('appointments').get();
  assert.deepEqual(after.docs.map(doc => [doc.id, doc.updateTime.toMillis()]), before.docs.map(doc => [doc.id, doc.updateTime.toMillis()]));
  const since = result.checkpoint;
  // A transaction may record an old event wall-clock. The server commit still
  // makes it visible to delta refresh, with its full previous lifecycle intact.
  const target = `${prefix}-000`;
  await db.collection('appointments').doc(target).update({
    cancelledAtIso: at, lifecycleHistory: [event, { ...event, id: 'C-LATE', kind: 'cancelled', to: null }], updatedAt: FieldValue.serverTimestamp(),
  });
  let found; cursor = null; let deltaPages = 0;
  do {
    result = await listScheduleHistory({ db, data: { since, cursor } });
    assert.ok(++deltaPages < 4, 'Nanosecond timestamp ties must not replay a page forever');
    if (result.nextCursor) assert.equal(result.nextCursor.afterTimestamp.nanoseconds, storedTimestamp.nanoseconds);
    found ||= result.appointments.find(item => item.appointmentId === target); cursor = result.nextCursor;
  } while (cursor);
  assert.equal(found.events.length, 2);
  const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => ({ uid: 'SYNTHETIC-OFFICE', role: 'office' }) });
  const response = await facade.handle({ method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: { action: 'list_schedule_history', data: {} } });
  assert.equal(response.status, 200); assert.equal(response.body.appointments.length, 50);
  assert.equal((await db.listCollections()).length, 1, 'History must create no collection, lock, message or work order');
});
