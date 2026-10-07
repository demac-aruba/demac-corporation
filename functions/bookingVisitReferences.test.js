const test = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceDb } = require('./test-support/referenceDb.cjs');
const { referenceInput, referenceFingerprint, validateReferenceFile, normalizeReferenceLocation, prepareVisitReferencesCommit, createVisitReferenceService, referenceMessageParts } = require('./bookingVisitReferences');
const NOW = new Date('2026-10-05T16:00:00Z');
const actor = { id: 'operator-1', source: 'office-scheduling' };
const upload = { id: 'upload-file-1', storagePath: 'booking-references/operator-1/upload-file-1', uploadedBy: 'operator-1', status: 'ready', expiresAt: '2026-10-06T16:00:00Z', fileName: 'kitchen.jpg', mimeType: 'image/jpeg', kind: 'image', size: 3 };
const input = { notes: 'Portón lateral\nAire de cocina', location: { url: '12.52, -70.03', label: 'Entrada lateral' }, files: [{ id: upload.id, description: 'Fuga visible en la conexión' }] };
const fixture = extra => new ReferenceDb({ 'users/operator-1': { active: true, role: 'office' }, 'bookingReferenceUploads/upload-file-1': upload, 'appointments/APT-1': { status: 'confirmed', date: '2026-10-05', customerId: 'C-1', propertyId: 'P-1' }, ...extra });

test('media policy accepts voice-note formats and rejects active content, mismatched types and oversized files', () => {
  assert.equal(validateReferenceFile({ fileName: 'note.opus', contentType: '', size: 10 }).kind, 'voice');
  for (const data of [{ fileName: 'bad.svg', contentType: 'image/svg+xml', size: 10 }, { fileName: 'bad.html', contentType: 'image/jpeg', size: 10 }, { fileName: 'a.jpg', contentType: 'image/jpeg', size: 26 * 1024 * 1024 }]) assert.throws(() => validateReferenceFile(data));
});
test('GPS accepts shared Maps links / coordinates and rejects unsafe URLs and invalid coordinates', () => {
  assert.match(normalizeReferenceLocation('12.52,-70.03').url, /query=12.52,-70.03/);
  assert.equal(normalizeReferenceLocation('https://maps.app.goo.gl/example').url, 'https://maps.app.goo.gl/example');
  for (const value of ['javascript:alert(1)', 'https://maps.app.goo.gl.evil.example/x', '91,20', 'http://maps.google.com/a', 'https://user:pass@maps.google.com']) assert.throws(() => normalizeReferenceLocation(value));
});
test('reference input preserves photo explanations and order without trusting client storage paths', () => {
  const value = referenceInput({ ...input, files: [{ ...input.files[0], storagePath: 'other/private' }] });
  assert.equal(value.files[0].storagePath, undefined);
  assert.match(value.notes, /\n/);
  assert.throws(() => referenceInput({ files: [input.files[0], input.files[0]] }));
  assert.notEqual(referenceFingerprint(input), referenceFingerprint({ ...input, notes: 'Other' }));
});
test('creation claims private staged uploads atomically with the appointment, no URL is persisted', async () => {
  const db = fixture();
  await db.runTransaction(async transaction => {
    const prepared = await prepareVisitReferencesCommit({ db, transaction, input, actor, appointmentId: 'APT-1', now: NOW });
    transaction.set(db.collection('appointments').doc('APT-1'), { visitReferences: prepared.value }, { merge: true }); prepared.write();
  });
  const refs = db.records.get('appointments/APT-1').visitReferences;
  assert.equal(refs.version, 1); assert.equal(refs.files[0].description, input.files[0].description);
  assert.equal(refs.files[0].url, undefined);
  assert.equal(db.records.get('bookingReferenceUploads/upload-file-1').appointmentId, 'APT-1');
});
test('file ownership, inactive roles, expired drafts, missing files and reuse across bookings fail without writes', async () => {
  for (const extra of [
    { 'users/operator-1': { active: true, role: 'technician' } },
    { 'users/operator-1': { active: false, role: 'office' } },
    { 'bookingReferenceUploads/upload-file-1': { ...upload, uploadedBy: 'another' } },
    { 'bookingReferenceUploads/upload-file-1': { ...upload, status: 'deleting' } },
    { 'bookingReferenceUploads/upload-file-1': { ...upload, appointmentId: 'APT-OTHER', status: 'linked' } },
    { 'bookingReferenceUploads/upload-file-1': { ...upload, expiresAt: '2026-10-04T00:00:00Z' } },
  ]) {
    const db = fixture(extra); const initial = JSON.stringify([...db.records]);
    await assert.rejects(db.runTransaction(transaction => prepareVisitReferencesCommit({ db, transaction, input, actor, appointmentId: 'APT-1', now: NOW })));
    assert.equal(JSON.stringify([...db.records]), initial);
  }
});
test('later edits are version checked, audited, idempotent and do not alter booking/work scope', async () => {
  const db = fixture(), service = createVisitReferenceService({ db, clock: () => NOW });
  const request = { appointmentId: 'APT-1', references: input, expectedVersion: 0, requestId: 'request-edit-001', actor };
  const first = await service.save(request), replay = await service.save(request);
  assert.equal(first.references.version, 1); assert.equal(replay.replayed, true);
  assert.equal(db.records.get('appointments/APT-1').propertyId, 'P-1');
  assert.equal(db.records.get('appointments/APT-1/referenceChanges/request-edit-001').actorId, actor.id);
  await assert.rejects(service.save({ ...request, requestId: 'request-stale-001' }), /Another operator/);
  await assert.rejects(service.save({ ...request, references: { ...input, notes: 'changed' } }), /different references/);
  const empty = await service.save({ ...request, requestId: 'request-edit-002', expectedVersion: 1, references: { notes: '', files: [], location: null } });
  assert.equal(empty.references.version, 2); assert.deepEqual(empty.references.files, []);
});
test('WhatsApp puts each caption with its own photo/video, and audio explanation immediately before voice media', () => {
  const photo = { ...upload, description: 'Foto cocina' };
  const video = { ...photo, id: 'video-file-1', kind: 'video', fileName: 'noise.mp4', description: 'Ruido compresor' };
  const voice = { ...photo, id: 'voice-file-1', kind: 'voice', fileName: 'client.opus', description: 'Explicación cliente' };
  const messages = referenceMessageParts({ text: 'Trabajo 2', appointment: { visitReferences: { files: [photo, video, voice] } }, order: { time: '14:30' }, client: { name: 'Synthetic customer' }, sequence: 2 });
  assert.equal(messages.length, 5); assert.equal(messages[0].text, 'Trabajo 2');
  assert.equal(messages[1].media.kind, 'image'); assert.match(messages[1].text, /Foto cocina/);
  assert.equal(messages[2].media.kind, 'video'); assert.match(messages[2].text, /Ruido compresor/);
  assert.match(messages[3].text, /Explicación cliente/); assert.equal(messages[3].media, undefined);
  assert.equal(messages[4].media.kind, 'voice');
});
