'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-transport-tests', storageBucket: 'demo-maya-transport-tests.appspot.com' });
const { getFirestore } = require('firebase-admin/firestore');
const { fixture, NOW, CONV, PHONE, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryOfferOutbound } = require('./mayaRecoveryOfferOutbound');
const { deliveryProof } = require('./mayaRecoveryDeliveryProof');
const { recoveryDispatchFingerprint, recoveryClaimIsUnchanged } = require('./mayaRecoveryDispatchReceipt');
const gateway = require('./whatsappWacliGateway');
const TOKEN = 'synthetic-bridge-for-offline-tests';
async function setup(t) {
  const f = await fixture();
  const firestore = getFirestore();
  t.mock.method(firestore, 'collection', name => f.db.collection(name));
  t.mock.method(firestore, 'runTransaction', (...args) => f.db.runTransaction(...args));
  const old = process.env.WACLI_BRIDGE_TOKEN;
  process.env.WACLI_BRIDGE_TOKEN = TOKEN;
  t.after(() => { if (old === undefined) delete process.env.WACLI_BRIDGE_TOKEN; else process.env.WACLI_BRIDGE_TOKEN = old; });
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() + 60000 });
  f.db.patch('businessSettings', 'customer-agent', { recoveryOutreachEnabled: true, recoveryContactPolicy: {
    version: 1, provider: 'wacli', timezone: 'America/Aruba', windows: [{ weekday: 1, start: '07:00', end: '08:00' }],
    cooldownMinutes: 60, minimumRemainingSeconds: 60 } });
  const offer = await f.prepare();
  const queued = await createMayaRecoveryOfferOutbound({ db: f.db, clock: () => NOW })
    .enqueue({ offerId: offer.offerId, offerVersion: offer.offerVersion });
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'synthetic-bridge', ACCOUNT, NOW.getTime());
  assert.equal(command.queueId, queued.queueId);
  return { ...f, offer, queued, command };
}
async function ack(f, overrides = {}, authorization = TOKEN) {
  const headers = { authorization: `Bearer ${authorization}`, 'x-demac-communication-account-id': ACCOUNT };
  const req = { method: 'POST', headers, body: { queueId: f.command.queueId, claimToken: f.command.claimToken,
    sent: true, messageId: 'provider-actual-shape-test', ...overrides }, get(name) { return headers[name.toLowerCase()]; } };
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set() { return this; }, on() { return this; } };
  await gateway.wacliOutboundAck(req, res);
  return res;
}
test('actual queue -> poll -> ACK -> delivery binding -> accepted Tuesday preserves canonical Thursday-to-Tuesday lifecycle', async t => {
  const f = await setup(t);
  const response = await ack(f);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.sent, true); assert.equal(response.body.recoveryDeliveryBound, true, JSON.stringify(response.body));
  const queue = f.db.read('whatsappOutboundQueue', f.command.queueId);
  assert.notEqual(queue.messageId, queue.providerMessageId);
  const message = f.db.read('whatsappMessages', queue.messageId);
  assert.equal(message.providerMessageId, queue.providerMessageId);
  assert.equal(message.whatsappTimestamp, undefined, 'server ACK time must not impersonate provider time');
  const offer = f.db.read('bookingOffers', f.offer.offerId);
  assert.equal(offer.recovery.delivery.timeBasis, 'bridge_acknowledgement');
  assert.equal(offer.recovery.delivery.providerAt, undefined);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  f.inbound();
  const accepted = await f.respond(f.offer);
  assert.equal(accepted.state, 'accepted'); assert.equal(accepted.appointment.date, '2026-09-08');
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'FULFILLED');
  assert.equal(f.db.read('bookingCapacityLocks', f.originalLocks[0].id).active, false);
  assert.equal(f.db.read('bookingCapacityLocks', f.targetLocks[0].id).active, true);
});
test('repeated real ACK keeps one original message and the exact same delivery receipt', async t => {
  const f = await setup(t); const first = await ack(f); assert.equal(first.body.recoveryDeliveryBound, true);
  const before = JSON.stringify([...f.db.docs]); const again = await ack(f);
  assert.equal(again.body.alreadyAcknowledged, true); assert.equal(again.body.recoveryDeliveryBound, true);
  assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('wrong or missing provider ID cannot fabricate a recovery ACK', async t => {
  const f = await setup(t); const before = JSON.stringify([...f.db.docs]);
  assert.equal((await ack(f, { messageId: '' })).statusCode, 400);
  assert.equal((await ack(f, { messageId: f.command.queueId })).statusCode, 400);
  assert.equal((await ack(f, {}, 'wrong-synthetic-token')).statusCode, 401);
  assert.equal(JSON.stringify([...f.db.docs]), before);
  await ack(f); assert.equal((await ack(f, { messageId: 'another-provider-message' })).statusCode, 409);
});
test('payload modified after claim cannot be falsely materialized by a later ACK', async t => {
  const f = await setup(t);
  f.db.patch('whatsappOutboundQueue', f.command.queueId, { text: 'A different message was not sent' });
  const before = JSON.stringify([...f.db.docs]);
  assert.equal((await ack(f)).statusCode, 409); assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('takeover after claim records actual delivery without authorizing an offer or erasing unread messages', async t => {
  const f = await setup(t);
  f.db.patch('communicationConversations', CONV, { aiDisposition: 'human_active', ownerUserId: 'operator-test', status: 'assigned', unread: 3 });
  const response = await ack(f);
  assert.equal(response.statusCode, 200); assert.equal(response.body.sent, true); assert.equal(response.body.recoveryDeliveryBound, false);
  assert.equal(f.db.read('whatsappOutboundQueue', f.command.queueId).status, 'sent');
  const conversation = f.db.read('communicationConversations', CONV);
  assert.equal(conversation.aiDisposition, 'human_active'); assert.equal(conversation.ownerUserId, 'operator-test');
  assert.equal(conversation.status, 'assigned'); assert.equal(conversation.unread, 3);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
});
test('new customer input before ACK is left for reconciliation, not silently accepted', async t => {
  const f = await setup(t); f.inbound();
  const response = await ack(f); assert.equal(response.statusCode, 200); assert.equal(response.body.recoveryDeliveryBound, false);
  await assert.rejects(() => f.respond(f.offer));
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
});
test('conflicting original provider message is not overwritten by recovery ACK', async t => {
  const f = await setup(t);
  const { wacliCanonicalIdentity } = require('./wacliCommunicationBoundary');
  const identity = wacliCanonicalIdentity({ communicationAccountId: ACCOUNT, chat: `${PHONE}@s.whatsapp.net`, providerMessageId: 'provider-actual-shape-test' });
  f.db.patch('whatsappMessages', identity.messageId, { direction: 'inbound', text: 'Do not overwrite' });
  const before = JSON.stringify([...f.db.docs]);
  assert.equal((await ack(f)).statusCode, 409); assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('ACK proof fails when canonical ID, provider ID, receipt timestamp or queue link changes', async t => {
  const f = await setup(t); await ack(f);
  const q = f.db.read('whatsappOutboundQueue', f.command.queueId); const m = f.db.read('whatsappMessages', q.messageId);
  const offer = f.db.read('bookingOffers', f.offer.offerId);
  for (const [collection, id, patch] of [
    ['whatsappOutboundQueue', f.command.queueId, { messageId: q.providerMessageId }],
    ['whatsappOutboundQueue', f.command.queueId, { providerMessageId: 'wrong' }],
    ['whatsappMessages', q.messageId, { recoveryAcknowledgedAtIso: '2099-01-01T00:00:00Z' }],
    ['whatsappMessages', q.messageId, { queueId: 'wrong' }],
  ]) {
    f.db.patch(collection, id, patch);
    await assert.rejects(() => deliveryProof(f.db, offer, f.command.queueId, q.messageId, new Date()));
    f.db.docs.set(`whatsappOutboundQueue/${f.command.queueId}`, q); f.db.docs.set(`whatsappMessages/${q.messageId}`, m);
  }
});
test('claim payload fingerprint ignores mutable transport status but binds recipient, text, offer and epochs', () => {
  const queue = { recoveryDispatchVersion: 1, to: PHONE, text: 'synthetic', status: 'queued' };
  const claimed = { ...queue, status: 'processing', recoveryDispatchAttemptedAtIso: NOW.toISOString(), recoveryDispatchFingerprint: recoveryDispatchFingerprint('MRO-test', queue) };
  assert.equal(recoveryClaimIsUnchanged('MRO-test', claimed), true);
  assert.equal(recoveryClaimIsUnchanged('MRO-test', { ...claimed, text: 'changed' }), false);
  assert.equal(recoveryClaimIsUnchanged('MRO-other', claimed), false);
});
test('canonical ingress retains voice MIME metadata in the recent-message projection', async t => {
  const f = await setup(t);
  const result = await gateway.persistCanonicalMessage({ communicationAccountId: ACCOUNT,
    payload: { Timestamp: new Date().toISOString() }, providerMessageId: 'voice-metadata-test', chat: `${PHONE}@s.whatsapp.net`,
    phone: PHONE, chatName: 'Synthetic', inbound: true, profilePicture: null,
    media: { mediaType: 'audio', mediaMimeType: 'audio/ogg' }, text: '[Audio]', reactionEmoji: null, reactionToId: null, webhookEventId: 'synthetic-webhook' });
  const recent = f.db.read('communicationConversations', result.conversationId).recentMessages.at(-1);
  assert.equal(recent.mediaMimeType, 'audio/ogg');
});
