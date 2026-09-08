'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-source-review', storageBucket: 'demo-maya-source-review.appspot.com' });
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createCustomerBookingInterestTools } = require('./demacCustomerBookingInterest');
const { interestSourceFingerprint } = require('./demacCustomerInterestSourceProof');
const { createMayaRecoveryOfferOutbound } = require('./mayaRecoveryOfferOutbound');
const { claimOutboundCommandWithDb } = require('./whatsappWacliGateway');
const QUOTE = 'Can you come earlier?';
async function setup() {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryOutreachEnabled: true, recoveryContactPolicy: {
    version: 1, provider: 'wacli', timezone: 'America/Aruba', windows: [{ weekday: 1, start: '07:00', end: '08:00' }],
    cooldownMinutes: 60, minimumRemainingSeconds: 60 } });
  const producer = createMayaRecoveryOfferOutbound({ db: f.db, clock: () => NOW });
  return { ...f, enqueue: offer => producer.enqueue({ offerId: offer.offerId, offerVersion: offer.offerVersion }) };
}
for (const suffix of [' Actually no, please keep Thursday.', ` ${'x'.repeat(9000)} Actually no, please keep Thursday.`]) {
  test(`review: edit retaining the original quote is rejected before enqueue (length ${suffix.length})`, async () => {
    const f = await setup(); const offer = await f.prepare(); f.db.writes.length = 0;
    f.db.patch('whatsappMessages', 'MSG-1', { text: QUOTE + suffix });
    const before = JSON.stringify([...f.db.docs]);
    await assert.rejects(() => f.enqueue(offer), error => error.code === 'recovery_interest_requires_review');
    assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.db.writes.length, 0);
  });
  test(`review: edit retaining the quote is rejected again at the real claim (length ${suffix.length})`, async () => {
    const f = await setup(); const offer = await f.prepare(); const queued = await f.enqueue(offer);
    f.db.patch('whatsappMessages', 'MSG-1', { text: QUOTE + suffix });
    assert.equal(await claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, NOW.getTime()), null);
    assert.equal(f.db.read('whatsappOutboundQueue', queued.queueId).recoveryAuthorizationReason, 'recovery_interest_requires_review');
    assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  });
}
test('review: replay cannot silently replace the captured source fingerprint after a customer edits the same message', async () => {
  const f = await setup();
  f.db.patch('whatsappMessages', 'MSG-1', { text: `${QUOTE} Actually, do not change it.` });
  const before = JSON.stringify([...f.db.docs]);
  const result = await createCustomerBookingInterestTools({ db: f.db, clock: () => NOW }).invoke('record_booking_interest', {
    action: 'register', kind: 'earlier_appointment', customerId: 'C-1', propertyId: 'P-1', appointmentId: 'APT-1',
    sourceQuote: QUOTE, dateFrom: '', dateTo: '',
  }, { conversationId: CONV, inboundMessageId: 'MSG-1' });
  assert.equal(result.success, false); assert.equal(result.error.code, 'stale_context');
  assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('review: an older direct preference without complete source proof requires review before outreach, not automatic backfill', async () => {
  const f = await setup();
  const record = { ...f.db.read('communicationCases', f.caseId) }; delete record.interestSourceFingerprint;
  f.db.docs.set(`communicationCases/${f.caseId}`, record);
  const offer = await f.prepare(); const before = JSON.stringify([...f.db.docs]);
  await assert.rejects(() => f.enqueue(offer), error => error.code === 'recovery_interest_requires_review');
  assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('review: changing the stored source proof also changes the immutable preference basis of an existing offer', async () => {
  const f = await setup(); const offer = await f.prepare();
  f.db.patch('communicationCases', f.caseId, { interestSourceFingerprint: 'another-proof' });
  await assert.rejects(() => f.enqueue(offer), error => error.code === 'recovery_preference_changed');
});
test('review: full evidence fingerprints cover revised completed transcripts and do not use a truncated prefix', () => {
  const message = { id: 'M', conversationId: CONV, communicationAccountId: ACCOUNT, direction: 'inbound', customerInputVersion: 1,
    type: 'audio', transcriptionStatus: 'completed', rawTranscript: QUOTE };
  const original = interestSourceFingerprint(message);
  assert.notEqual(interestSourceFingerprint({ ...message, rawTranscript: QUOTE + ' Actually no.' }), original);
  assert.notEqual(interestSourceFingerprint({ ...message, transcriptionStatus: 'failed' }), original);
  assert.notEqual(interestSourceFingerprint({ ...message, rawTranscript: QUOTE + ' '.repeat(10) + 'x'.repeat(9000) + ' no' }), original);
  assert.equal(interestSourceFingerprint({ ...message, rawTranscript: `  ${QUOTE}  ` }), original);
});
