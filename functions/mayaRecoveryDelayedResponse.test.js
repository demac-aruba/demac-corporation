'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-delayed-tests', storageBucket: 'demo-maya-delayed-tests.appspot.com' });
const { getFirestore } = require('firebase-admin/firestore');
const { fixture, NOW, CONV, PHONE, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryOfferOutbound } = require('./mayaRecoveryOfferOutbound');
const { createMayaRecoveryConversationTools } = require('./mayaRecoveryConversationTools');
const { wacliCanonicalIdentity } = require('./wacliCommunicationBoundary');
const { deliveryProof } = require('./mayaRecoveryDeliveryProof');
const gateway = require('./whatsappWacliGateway');
const TOKEN = 'offline-delayed-ack-test';
const PROVIDER_ID = 'synthetic-continuity-provider-message';
async function setup(t) {
  const f = await fixture();
  const firestore = getFirestore();
  t.mock.method(firestore, 'collection', name => f.db.collection(name));
  t.mock.method(firestore, 'runTransaction', (...args) => f.db.runTransaction(...args));
  const previous = process.env.WACLI_BRIDGE_TOKEN;
  process.env.WACLI_BRIDGE_TOKEN = TOKEN;
  t.after(() => { if (previous === undefined) delete process.env.WACLI_BRIDGE_TOKEN; else process.env.WACLI_BRIDGE_TOKEN = previous; });
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() + 180000 });
  f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: true, recoveryOutreachEnabled: true,
    recoveryContactPolicy: { version: 1, provider: 'wacli', timezone: 'America/Aruba',
      windows: [{ weekday: 1, start: '07:00', end: '08:00' }], cooldownMinutes: 60, minimumRemainingSeconds: 60 } });
  const offer = await f.prepare();
  const queued = await createMayaRecoveryOfferOutbound({ db: f.db, clock: () => NOW })
    .enqueue({ offerId: offer.offerId, offerVersion: offer.offerVersion });
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, NOW.getTime());
  assert.equal(command.queueId, queued.queueId);
  const identity = wacliCanonicalIdentity({ communicationAccountId: ACCOUNT, chat: `${PHONE}@s.whatsapp.net`, providerMessageId: PROVIDER_ID });
  return { ...f, offer, command, identity };
}
function echo(f) {
  // Controlled canonical provider echo, not a real webhook/device assertion.
  f.db.patch('whatsappMessages', f.identity.messageId, { provider: 'wacli', channel: 'whatsapp', direction: 'outbound',
    conversationId: CONV, communicationAccountId: ACCOUNT, providerMessageId: PROVIDER_ID, text: f.offer.messageText,
    whatsappTimestamp: new Date(NOW.getTime() + 60000).toISOString(),
    firstIngestedAtIso: new Date(NOW.getTime() + 61000).toISOString(), webhookEventId: 'ECHO-1' });
  f.db.patch('whatsappWebhookEvents', 'ECHO-1', { source: 'wacli', provider: 'wacli', processed: true,
    communicationAccountId: ACCOUNT, eventType: 'message', auth: 'bridge-bearer-account-bound-v1' });
}
async function ack(f) {
  const headers = { authorization: `Bearer ${TOKEN}`, 'x-demac-communication-account-id': ACCOUNT };
  const request = { method: 'POST', body: { queueId: f.command.queueId, claimToken: f.command.claimToken,
    sent: true, messageId: PROVIDER_ID }, get: name => headers[name.toLowerCase()] };
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set() { return this; }, on() { return this; } };
  await gateway.wacliOutboundAck(request, response);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  return response.body;
}
const saved = f => JSON.stringify([...f.db.docs]);

test('verified earlier provider echo reconciles customer reply before late ACK through real handler and canonical lifecycle', async t => {
  const f = await setup(t); echo(f); f.inbound();
  const acknowledgement = await ack(f);
  assert.equal(acknowledgement.recoveryDeliveryBound, false);
  assert.equal(f.db.read('bookingOffers', f.offer.offerId).recovery.state, 'prepared');
  f.setTime(new Date(NOW.getTime() + 181000));
  const tools = createMayaRecoveryConversationTools({ db: f.db, clock: () => new Date(NOW.getTime() + 181000) });
  const before = saved(f);
  const context = await tools.invokeIfScoped('get_appointment_change_context', {}, { conversationId: CONV, inboundMessageId: 'MSG-2' });
  assert.equal(context.responseEvidenceReady, true, JSON.stringify(context));
  assert.equal(context.deliveryReconciledReadOnly, true);
  assert.equal(saved(f), before, 'context inspection cannot write binding, resend or move a booking');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  const result = await f.respond(f.offer);
  assert.equal(result.state, 'accepted'); assert.equal(result.appointment.date, '2026-09-08');
  const delivered = f.db.read('bookingOffers', f.offer.offerId).recovery.delivery;
  assert.equal(delivered.timeBasis, 'provider_message_with_ack');
  assert.ok(delivered.providerAt < Date.parse(f.db.read('whatsappMessages', 'MSG-2').whatsappTimestamp));
  assert.ok(delivered.acknowledgedAt > Date.parse(f.db.read('whatsappMessages', 'MSG-2').whatsappTimestamp));
  assert.equal([...f.db.docs.keys()].filter(path => path.startsWith('whatsappOutboundQueue/')).length, 1);
});
test('ACK-only reply preceding acknowledgement remains unproven and cannot move Thursday', async t => {
  const f = await setup(t); f.inbound(); const result = await ack(f);
  assert.equal(result.recoveryDeliveryBound, false);
  f.setTime(new Date(NOW.getTime() + 181000)); const before = saved(f);
  await assert.rejects(() => f.respond(f.offer), { code: 'recovery_response_predates_offer' });
  assert.equal(saved(f), before); assert.equal(f.analysisCalls.length, 0);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
});
test('already acknowledged send with lagging binding can be reconstructed read-only for a later reply', async t => {
  const f = await setup(t); f.inbound(); await ack(f);
  // The source is now strictly later than the recorded ACK. No provider time is invented.
  f.db.patch('whatsappMessages', 'MSG-2', { whatsappTimestamp: new Date(NOW.getTime() + 190000).toISOString(),
    firstIngestedAtIso: new Date(NOW.getTime() + 190000).toISOString() });
  f.setTime(new Date(NOW.getTime() + 191000));
  assert.equal((await f.respond(f.offer)).state, 'accepted');
  assert.equal(f.db.read('bookingOffers', f.offer.offerId).recovery.delivery.timeBasis, 'bridge_acknowledgement');
});
for (const [label, change] of [
  ['unprocessed webhook', f => f.db.patch('whatsappWebhookEvents', 'ECHO-1', { processed: false })],
  ['foreign webhook account', f => f.db.patch('whatsappWebhookEvents', 'ECHO-1', { communicationAccountId: 'foreign' })],
  ['missing webhook', f => f.db.docs.delete('whatsappWebhookEvents/ECHO-1')],
  ['unverified webhook authentication', f => f.db.patch('whatsappWebhookEvents', 'ECHO-1', { auth: 'unknown' })],
  ['echo timestamp before dispatch attempt', f => f.db.patch('whatsappMessages', f.identity.messageId,
    { whatsappTimestamp: new Date(NOW.getTime() - 1000).toISOString() })],
  ['changed original payload', f => f.db.patch('whatsappMessages', f.identity.messageId, { text: 'Another offer' })],
]) {
  test(`${label} cannot supply a permissive chronology fallback`, async t => {
    const f = await setup(t); echo(f); f.inbound(); await ack(f); change(f);
    f.setTime(new Date(NOW.getTime() + 181000)); const before = saved(f);
    await assert.rejects(() => f.respond(f.offer)); assert.equal(saved(f), before);
    assert.equal(f.analysisCalls.length, 0); assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  });
}
test('previously bound ACK proof does not silently change when an echo becomes available later', async t => {
  const f = await setup(t);
  // No inbound response yet: normal binding succeeds using the observed ACK time.
  await ack(f); const offer = { ...f.db.read('bookingOffers', f.offer.offerId), id: f.offer.offerId };
  assert.equal(offer.recovery.delivery.timeBasis, 'bridge_acknowledgement');
  echo(f);
  // Preserve the ACK fields on the same original message; echo() is a merge.
  const proof = await deliveryProof(f.db, offer, f.command.queueId, f.identity.messageId, new Date());
  assert.deepEqual(proof, offer.recovery.delivery);
});
test('read-only reconciliation never proceeds when phone permission has been revoked', async t => {
  const f = await setup(t); echo(f); f.inbound(); await ack(f); f.setTime(new Date(NOW.getTime() + 181000));
  f.db.patch('businessSettings', 'customer-agent', { autoReplyAllowlist: [] });
  const before = saved(f); await assert.rejects(() => f.respond(f.offer)); assert.equal(saved(f), before);
});
