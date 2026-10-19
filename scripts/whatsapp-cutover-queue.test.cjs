'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ReferenceDb } = require('../functions/test-support/referenceDb.cjs');
const { CUTOFF, obsolete, discardBacklog, tombstone } = require('./whatsapp-cutover-queue.cjs');
const FieldValue = { serverTimestamp: () => '2026-10-19T14:00:00Z' };
function fixture() {
  const to = 'synthetic-recipient';
  const lock = crypto.createHash('sha256').update(to).digest('hex');
  const db = new ReferenceDb({
    'whatsappOutboundQueue/old': { to, provider: 'wacli', status: 'queued', createdAt: '2026-10-19T13:00:00Z', type: 'booking-reference-bundle', messages: [{ text: 'PRIVATE BODY' }], messageIndex: 1, claimToken: 'PRIVATE TOKEN' },
    'whatsappOutboundQueue/failed': { to, status: 'failed', createdAt: '2026-10-17T12:00:00Z', text: 'PRIVATE BODY' },
    'whatsappOutboundQueue/new': { to, status: 'queued', createdAt: CUTOFF, text: 'new work' },
    'whatsappOutboundQueue/sent': { to, status: 'sent', createdAt: '2026-10-19T12:00:00Z', text: 'sent history' },
    ['whatsappOutboundDispatchLocks/' + lock]: { activeQueueId: 'old' },
    'workOrders/one': { unchanged: true },
  });
  return { db, lock };
}
test('cutover is exclusive and missing timestamps fail closed', () => {
  assert.equal(obsolete({ createdAt: CUTOFF }), false);
  assert.equal(obsolete({ createdAtIso: '2026-10-19T13:34:14Z' }), true);
  assert.equal(obsolete({}), true);
  assert.equal(obsolete({ createdAt: { toMillis: () => Date.parse(CUTOFF) + 1 } }), false);
});
test('dry-run never writes; apply removes only earlier unsent payloads and preserves new work/history', async () => {
  const { db, lock } = fixture(); const before = JSON.stringify([...db.records]);
  const preview = await discardBacklog({ db, FieldValue });
  assert.equal(JSON.stringify([...db.records]), before);
  assert.equal(preview.discardCount, 2); assert.equal(preview.preserveNewCount, 1);
  const result = await discardBacklog({ db, FieldValue, execute: true, expectedFingerprint: preview.fingerprint });
  assert.equal(result.discardCount, 2);
  assert.equal(db.records.get('whatsappOutboundQueue/old').status, 'cancelled');
  assert.doesNotMatch(JSON.stringify(db.records.get('whatsappOutboundQueue/old')), /PRIVATE/);
  assert.equal(db.records.get('whatsappOutboundQueue/new').text, 'new work');
  assert.equal(db.records.get('whatsappOutboundQueue/sent').text, 'sent history');
  assert.deepEqual(db.records.get('workOrders/one'), { unchanged: true });
  assert.equal(db.records.get('whatsappOutboundDispatchLocks/' + lock).activeQueueId, null);
  const repeat = await discardBacklog({ db, FieldValue });
  assert.equal(repeat.discardCount, 0);
  assert.equal((await discardBacklog({ db, FieldValue, execute: true, expectedFingerprint: repeat.fingerprint })).discardCount, 0);
});
test('changed queue and in-flight old work block all writes', async () => {
  const { db } = fixture(); const preview = await discardBacklog({ db, FieldValue });
  db.records.get('whatsappOutboundQueue/old').text = 'changed';
  const before = JSON.stringify([...db.records]);
  await assert.rejects(discardBacklog({ db, FieldValue, execute: true, expectedFingerprint: preview.fingerprint }), /changed after dry-run/);
  assert.equal(JSON.stringify([...db.records]), before);
  db.records.get('whatsappOutboundQueue/old').status = 'processing';
  await assert.rejects(discardBacklog({ db, FieldValue }), /in flight/);
});
test('cutover tombstone keeps no message payload or sending capability', () => {
  const value = tombstone({ status:'queued',to:'synthetic',text:'PRIVATE',messages:[{text:'PRIVATE'}],media:{url:'PRIVATE'},claimToken:'PRIVATE',phone:'PRIVATE' }, 'now');
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
  assert.equal(value.payloadRemoved, true); assert.equal(value.to, 'synthetic');
});
