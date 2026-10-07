const test = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { createReferenceHttpHandler, cleanupReferenceUploads, notifyReferenceUpdate } = require('./bookingVisitReferencesHttp');
function fixture(extra = {}) {
  const db = new ReferenceDb({ 'users/office': { role: 'office', active: true }, 'users/tech': { role: 'technician', staffId: 'STAFF-1', active: true },
    'appointments/APT-1': { status: 'confirmed', date: '2026-10-05', visitReferences: { version: 1, notes: 'Kitchen', files: [{ id: 'photo-file-1', storagePath: 'booking-references/office/photo-file-1', mimeType: 'image/jpeg', fileName: 'photo.jpg' }] } },
    'workOrders/WO-1': { appointmentId: 'APT-1', date: '2026-10-05' }, ...extra });
  const objects = new Map([['booking-references/office/photo-file-1', Buffer.from('image')]]);
  const bucket = { file: path => ({ save: async bytes => objects.set(path, bytes), download: async () => [objects.get(path)], delete: async () => objects.delete(path) }) };
  const authorizeJob = async (_db, identity, id) => { if (identity.staffId !== 'STAFF-1' || id !== 'WO-1') throw Object.assign(new Error('Not assigned'), { status: 403 }); };
  const handler = createReferenceHttpHandler({ db, bucket, verifyIdToken: async token => ({ uid: token }), clock: () => new Date('2026-10-05T16:00:00Z'), authorizeJob });
  const call = async ({ uid = 'office', method = 'GET', query = { appointmentId: 'APT-1' }, body, bytes, contentType = 'image/jpeg' } = {}) => {
    const res = response(); await handler({ method, query, body, rawBody: bytes,
      get: name => name === 'authorization' ? (uid ? `Bearer ${uid}` : '') : name === 'content-type' ? contentType : '' }, res); return res;
  };
  return { db, bucket, objects, call };
}
test('reference HTTP rejects missing auth / disabled accounts and technician writes', async () => {
  const { call } = fixture({ 'users/disabled': { role: 'admin', active: false } });
  assert.equal((await call({ uid: '' })).statusCode, 401);
  assert.equal((await call({ uid: 'disabled' })).statusCode, 403);
  assert.equal((await call({ uid: 'unknown' })).statusCode, 403);
  assert.equal((await call({ uid: 'tech', method: 'POST', body: {} })).statusCode, 403);
});
test('private upload has exact retry, private bytes and no permanent download URL', async () => {
  const { db, objects, call } = fixture();
  const args = { method: 'POST', query: { action: 'upload', uploadId: 'file-upload-001', fileName: 'unit.jpg' }, bytes: Buffer.from('jpeg') };
  const first = await call(args); assert.equal(first.statusCode, 200);
  assert.equal(first.body.file.url, undefined); assert.equal(objects.size, 2);
  assert.equal(db.records.get('bookingReferenceUploads/file-upload-001').status, 'ready');
  assert.equal((await call(args)).statusCode, 200);
  assert.equal((await call({ ...args, bytes: Buffer.from('different') })).statusCode, 409);
  const privateRead = await call({ query: { fileId: 'file-upload-001' } });
  assert.equal(privateRead.statusCode, 200); assert.match(privateRead.headers['Content-Security-Policy'], /sandbox/);
  assert.equal((await call({ uid: 'tech', query: { fileId: 'file-upload-001' } })).statusCode, 400);
});
test('technician references require current-day assigned job and resolve appointment server-side', async () => {
  const { call } = fixture();
  const good = await call({ uid: 'tech', query: { workOrderId: 'WO-1', appointmentId: 'APT-OTHER', fileId: 'photo-file-1' } });
  assert.equal(good.statusCode, 200); assert.equal(good.body.toString(), 'image');
  assert.equal((await call({ uid: 'tech', query: { workOrderId: 'WO-OTHER' } })).statusCode, 403);
  const yesterday = fixture({ 'workOrders/WO-1': { appointmentId: 'APT-1', date: '2026-10-04' } });
  assert.equal((await yesterday.call({ uid: 'tech', query: { workOrderId: 'WO-1' } })).statusCode, 403);
});
test('expired orphan cleanup claims deletion, preserves linked files and removes abandoned bytes', async () => {
  const { db, bucket, objects } = fixture({
    'bookingReferenceUploads/photo-file-1': { status: 'linked', appointmentId: 'APT-1', expiresAt: '9999-12-31T23:59:59.999Z', storagePath: 'booking-references/office/photo-file-1' },
    'bookingReferenceUploads/orphan-file-1': { status: 'ready', expiresAt: '2026-10-04T00:00:00Z', storagePath: 'booking-references/office/orphan-file-1' },
  });
  objects.set('booking-references/office/orphan-file-1', Buffer.from('orphan'));
  assert.equal(await cleanupReferenceUploads({ db, bucket, now: new Date('2026-10-05T16:00:00Z') }), 1);
  assert.equal(objects.has('booking-references/office/photo-file-1'), true);
  assert.equal(objects.has('booking-references/office/orphan-file-1'), false);
});
test('historical, future, pre-08:00, unchanged and held reference updates never queue WhatsApp', async () => {
  const db = { collection() { throw new Error('Must not touch queue'); } };
  const before = { visitReferences: { version: 1 } };
  for (const after of [
    { date: '2026-10-05', status: 'confirmed', backdated: true, visitReferences: { version: 2 } },
    { date: '2026-10-06', status: 'confirmed', visitReferences: { version: 2 } },
    { date: '2026-10-05', status: 'temporary_hold', visitReferences: { version: 2 } },
    { date: '2026-10-05', status: 'confirmed', visitReferences: { version: 1 } },
  ]) await notifyReferenceUpdate({ db, before, after, appointmentId: 'APT-1', now: new Date('2026-10-05T16:00:00Z') });
  await notifyReferenceUpdate({ db, before, after: { date: '2026-10-05', status: 'confirmed', visitReferences: { version: 2 } }, appointmentId: 'APT-1', now: new Date('2026-10-05T11:59:00Z') });
});

test('after 08:00 updates reach each currently assigned Van once with native files; stale events are ignored', async () => {
  const after = { date: '2026-10-05', status: 'confirmed', visitReferences: { version: 2, notes: 'New kitchen instructions', files: [
    { id: 'photo-0001', storagePath: 'booking-references/office/photo-0001', mimeType: 'image/jpeg', kind: 'image', fileName: 'unit.jpg', description: 'Right connection' },
  ] } };
  const before = { ...after, visitReferences: { version: 1 } };
  const db = new ReferenceDb({ 'appointments/APT-1': after,
    'vans/VAN-1': { active: true, whatsappScheduleGroupJid: '120000000000000001@g.us' },
    'vans/VAN-2': { active: true, whatsappScheduleGroupJid: '120000000000000002@g.us' },
    'workOrders/WO-1': { appointmentId: 'APT-1', date: '2026-10-05', time: '13:00', status: 'Confirmada', vanId: 'VAN-1', appointmentAssignmentRole: 'primary' },
    'workOrders/WO-2': { appointmentId: 'APT-1', date: '2026-10-05', time: '13:00', status: 'Confirmada', vanId: 'VAN-2', appointmentAssignmentRole: 'support' },
  });
  const call = () => notifyReferenceUpdate({ db, before, after, appointmentId: 'APT-1', now: new Date('2026-10-05T16:00:00Z') });
  await call(); await call();
  const queued = [...db.records.entries()].filter(([key]) => key.startsWith('whatsappOutboundQueue/')).map(([, row]) => row);
  assert.equal(queued.length, 2);
  for (const row of queued) { assert.equal(row.type, 'booking-reference-bundle'); assert.match(row.messages[0].text, /REFERENCIAS ACTUALIZADAS/); assert.equal(row.messages[1].media.kind, 'image'); assert.match(row.messages[1].text, /Right connection/); }
  db.records.set('appointments/APT-1', { ...after, visitReferences: { ...after.visitReferences, version: 3 } });
  await call();
  assert.equal([...db.records.keys()].filter(key => key.startsWith('whatsappOutboundQueue/')).length, 2);
});
