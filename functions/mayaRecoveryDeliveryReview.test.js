'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-delivery-review', storageBucket: 'demo-maya-delivery-review.appspot.com' });
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryOfferOutbound } = require('./mayaRecoveryOfferOutbound');
const { claimOutboundCommandWithDb } = require('./whatsappWacliGateway');
const { deliveryProof } = require('./mayaRecoveryDeliveryProof');
async function delivered() {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryOutreachEnabled: true, recoveryContactPolicy: {
    version: 1, provider: 'wacli', timezone: 'America/Aruba', windows: [{ weekday: 1, start: '07:00', end: '08:00' }],
    cooldownMinutes: 60, minimumRemainingSeconds: 60 } });
  const prepared = await f.prepare();
  const queued = await createMayaRecoveryOfferOutbound({ db: f.db, clock: () => NOW }).enqueue({ offerId: prepared.offerId, offerVersion: prepared.offerVersion });
  await claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, NOW.getTime());
  const ackAt = new Date(NOW.getTime() + 60000);
  f.db.patch('whatsappOutboundQueue', queued.queueId, { status: 'sent', messageId: 'ACK-REVIEW', providerMessageId: 'provider-review', recoveryAcknowledgedAtIso: ackAt.toISOString() });
  f.db.patch('whatsappMessages', 'ACK-REVIEW', { provider: 'wacli', direction: 'outbound', conversationId: CONV,
    communicationAccountId: ACCOUNT, providerMessageId: 'provider-review', queueId: queued.queueId,
    text: prepared.messageText, recoveryAcknowledgedAtIso: ackAt.toISOString() });
  const offer = { ...f.db.read('bookingOffers', prepared.offerId), id: prepared.offerId };
  const verify = () => deliveryProof(f.db, offer, queued.queueId, 'ACK-REVIEW', ackAt);
  await verify();
  return { ...f, queued, offer, verify };
}
for (const [label, patch] of [
  ['claimed text', { text: 'A different sent message' }],
  ['claimed recipient', { to: '2975609999' }],
  ['claim fingerprint', { recoveryDispatchFingerprint: 'modified' }],
  ['future claim time', { recoveryDispatchAttemptedAtIso: '2099-01-01T00:00:00Z' }],
  ['claim before offer', { recoveryDispatchAttemptedAtIso: '2026-09-01T00:00:00Z' }],
  ['recorded policy', { recoveryContactPolicyFingerprint: 'modified' }],
]) {
  test(`review: changed ${label} cannot validate delivery for later appointment acceptance`, async () => {
    const f = await delivered(); f.db.patch('whatsappOutboundQueue', f.queued.queueId, patch);
    await assert.rejects(f.verify, error => error.code === 'recovery_delivery_unproven');
    assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  });
}
test('review: removing governed ACK metadata cannot fall back to legacy provider-time proof', async () => {
  const f = await delivered();
  const queue = { ...f.db.read('whatsappOutboundQueue', f.queued.queueId) };
  const message = { ...f.db.read('whatsappMessages', 'ACK-REVIEW'), firstIngestedAtIso: queue.recoveryAcknowledgedAtIso, whatsappTimestamp: queue.recoveryAcknowledgedAtIso };
  delete queue.recoveryAcknowledgedAtIso; delete message.recoveryAcknowledgedAtIso;
  f.db.docs.set(`whatsappOutboundQueue/${f.queued.queueId}`, queue); f.db.docs.set('whatsappMessages/ACK-REVIEW', message);
  await assert.rejects(f.verify, error => error.code === 'recovery_delivery_unproven');
});
test('review: missing or changed offer-to-queue pointer cannot be substituted with another sent item', async () => {
  const f = await delivered();
  f.offer.recovery = { ...f.offer.recovery, outbound: null };
  await assert.rejects(f.verify, error => error.code === 'recovery_delivery_unproven');
});
