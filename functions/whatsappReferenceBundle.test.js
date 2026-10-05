const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');
const { bundleFailure, currentBundlePart } = require('./whatsappReferenceBundle');
function gateway(db) {
  const filename = path.join(__dirname, 'whatsappWacliGateway.js');
  const localRequire = createRequire(filename);
  const exported = {};
  const mocks = {
    'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => new Date().toISOString(), increment: n => n }, Timestamp: { fromMillis: ms => ({ toMillis: () => ms }) } },
    'firebase-admin/storage': { getStorage: () => ({ bucket: () => ({ file: () => ({ download: async () => [Buffer.from('private-reference')] }) }) }) },
    'firebase-functions/logger': { info() {}, warn() {}, error() {} },
    'firebase-functions/params': { defineSecret: () => ({ value: () => 'synthetic-bridge-token' }) },
    'firebase-functions/v2/firestore': { onDocumentCreated: (_options, fn) => fn },
    'firebase-functions/v2/https': { onRequest: (_options, fn) => fn },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: name => mocks[name] || localRequire(name), exports: exported, module: { exports: exported },
    Buffer, URL, Date, Map, Set, process: { env: { GCLOUD_PROJECT: 'demo-references' } }, console }, { filename });
  async function call(name, body = {}, query = {}) {
    const res = response();
    await exported[name]({ method: name === 'wacliBookingReferenceMedia' ? 'GET' : 'POST', body, query, get: key => key === 'authorization' ? 'Bearer synthetic-bridge-token' : '' }, res);
    assert.notEqual(res.statusCode, 500, JSON.stringify(res.body));
    return res;
  }
  return { call, poll: async () => (await call('wacliOutboundPoll')).body.command,
    ack: async (command, sent = true) => call('wacliOutboundAck', { queueId: command.queueId, claimToken: command.claimToken, sent, messageId: sent ? `msg-${command.claimToken}` : '', error: 'Synthetic temporary error' }) };
}
function fixture() {
  const db = new ReferenceDb({
    'whatsappOutboundQueue/WORK-1': { provider: 'wacli', type: 'booking-reference-bundle', appointmentId: 'APT-1', to: '120000000000001@g.us', status: 'queued', createdAt: '2026-10-05T12:00:00Z', messageIndex: 0,
      messages: [{ text: 'Work 1' }, { text: 'Photo: kitchen', media: { kind: 'image', storagePath: 'booking-references/office/photo-0001', fileName: 'kitchen.jpg', mimeType: 'image/jpeg' } },
        { text: 'Audio explanation' }, { text: '', media: { kind: 'voice', storagePath: 'booking-references/office/audio-0001', fileName: 'voice.opus', mimeType: 'audio/ogg' } }] },
    'whatsappOutboundQueue/WORK-2': { provider: 'wacli', type: 'text', text: 'Work 2', to: '120000000000001@g.us', status: 'queued', createdAt: '2026-10-05T12:00:01Z', dependsOnQueueId: 'WORK-1' },
    'bookingReferenceUploads/photo-0001': { status: 'linked', appointmentId: 'APT-1', storagePath: 'booking-references/office/photo-0001', mimeType: 'image/jpeg' },
  });
  return { db, ...gateway(db) };
}
test('bundle sends work → captioned photo → audio explanation → voice before next work; ack retries never advance twice', async () => {
  const { db, poll, ack, call } = fixture();
  const first = await poll(); assert.equal(first.text, 'Work 1'); assert.equal(await poll(), null);
  assert.equal((await ack(first)).statusCode, 200);
  assert.equal(db.records.get('whatsappOutboundQueue/WORK-1').messageIndex, 1);
  assert.equal((await ack(first)).body.alreadyAcknowledged, true);
  assert.equal(db.records.get('whatsappOutboundQueue/WORK-1').messageIndex, 1);
  const photo = await poll(); assert.equal(photo.text, 'Photo: kitchen'); assert.equal(photo.media.kind, 'image');
  assert.match(photo.media.url, /wacliBookingReferenceMedia/); assert.equal(photo.media.storagePath, undefined);
  const good = await call('wacliBookingReferenceMedia', {}, { queueId: photo.queueId, claimToken: photo.claimToken });
  assert.equal(good.statusCode, 200); assert.equal(good.body.toString(), 'private-reference');
  const manifest = db.records.get('bookingReferenceUploads/photo-0001');
  for (const replacement of [{ ...manifest, status: 'ready', appointmentId: null }, { ...manifest, appointmentId: 'APT-OTHER' }]) {
    db.records.set('bookingReferenceUploads/photo-0001', replacement);
    assert.equal((await call('wacliBookingReferenceMedia', {}, { queueId: photo.queueId, claimToken: photo.claimToken })).statusCode, 403);
  }
  db.records.set('bookingReferenceUploads/photo-0001', manifest);
  assert.equal((await call('wacliBookingReferenceMedia', {}, { queueId: photo.queueId, claimToken: 'wrong' })).statusCode, 403);
  await ack(photo);
  assert.equal((await call('wacliBookingReferenceMedia', {}, { queueId: photo.queueId, claimToken: photo.claimToken })).statusCode, 403);
  const explanation = await poll(); assert.equal(explanation.text, 'Audio explanation'); await ack(explanation);
  const voice = await poll(); assert.equal(voice.media.kind, 'voice'); await ack(voice);
  assert.equal(db.records.get('whatsappOutboundQueue/WORK-1').status, 'sent');
  assert.equal(db.records.get('whatsappOutboundQueue/WORK-1').sentMessageIds.length, 4);
  const next = await poll(); assert.equal(next.text, 'Work 2');
});
test('another message cannot interrupt an active bundle for the same group, while other groups remain available', async () => {
  const { db, poll, ack } = fixture();
  const first = await poll();
  db.records.set('whatsappOutboundQueue/URGENT', { provider: 'wacli', type: 'text', to: first.to, text: 'Other update', status: 'queued', createdAt: '2026-10-05T11:00:00Z' });
  db.records.set('whatsappOutboundQueue/OTHER-VAN', { provider: 'wacli', type: 'text', to: '120000000000002@g.us', text: 'Another van', status: 'queued', createdAt: '2026-10-05T11:01:00Z' });
  const other = await poll(); assert.equal(other.text, 'Another van'); await ack(other);
  assert.equal(await poll(), null); await ack(first);
  assert.equal((await poll()).text, 'Photo: kitchen');
});
test('failed part retains its cursor, retries are delayed/bounded and a terminal failure blocks later work', async () => {
  const { db, poll, ack } = fixture();
  const first = await poll(); await ack(first);
  for (let i = 0; i < 3; i++) {
    const row = db.records.get('whatsappOutboundQueue/WORK-1'); row.retryAfterIso = null;
    const photo = await poll(); assert.equal(photo.media.kind, 'image');
    const failed = await ack(photo, false); assert.equal(failed.statusCode, 200);
    assert.equal((await ack(photo, false)).body.alreadyAcknowledged, true);
    assert.equal(row.messageIndex, 1);
    assert.equal(await poll(), null);
  }
  assert.equal(db.records.get('whatsappOutboundQueue/WORK-1').status, 'failed');
  assert.equal(db.records.get('whatsappOutboundQueue/WORK-2').status, 'queued');
  assert.equal(bundleFailure({ type: 'text' }).status, 'failed');
  assert.throws(() => currentBundlePart({ type: 'booking-reference-bundle', messages: [] }));
});

test('blocked first page cannot starve the predecessor or another group beyond 50 queue records', async () => {
  const { db, poll } = fixture();
  for (let index = 0; index < 60; index++) db.records.set(`whatsappOutboundQueue/BLOCKED-${String(index).padStart(3, '0')}`, {
    provider: 'wacli', status: 'queued', to: '120000000000001@g.us', text: 'Later job', dependsOnQueueId: 'WORK-1',
  });
  assert.equal((await poll()).text, 'Work 1');
});

test('a processing plain text reserves its recipient before a bundle can start and failure releases that reservation', async () => {
  const { db, poll, ack } = fixture();
  db.records.set('whatsappOutboundQueue/TEXT', { provider: 'wacli', type: 'text', to: '120000000000001@g.us', text: 'Earlier text', status: 'queued', createdAt: '2026-10-05T10:00:00Z' });
  const plain = await poll(); assert.equal(plain.text, 'Earlier text'); assert.equal(await poll(), null);
  await ack(plain, false);
  const header = await poll(); assert.equal(header.text, 'Work 1');
  const lease = db.records.get('whatsappOutboundQueue/WORK-1').leaseUntil.toMillis();
  assert.ok(lease - Date.now() > 9 * 60000, 'Media lease covers download, conversion, send and ACK');
});
