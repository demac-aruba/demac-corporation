'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW, CONV } = require('./test-support/mayaRecoveryOffersFixture');
const { createCustomerBookingInterestTools } = require('./demacCustomerBookingInterest');
async function ready() {
  const f = await fixture(); const prepared = await f.prepare(); await f.delivered(prepared); f.inbound();
  return { ...f, prepared };
}
const accept = input => ({ decision: 'accept', quote: input.customerText, confidence: 0.99, ambiguous: false });
const snapshot = db => JSON.stringify([...db.docs]);

test('review: semantic disagreement cannot turn a decline into an acceptance', async () => {
  const f = await ready(); const text = f.inbound('No, keep Thursday.'); const before = snapshot(f.db);
  await assert.rejects(() => f.respond(f.prepared, 'accept', text), error => error.code === 'recovery_response_requires_clarification');
  assert.equal(snapshot(f.db), before);
});
for (const patch of [{ confidence: 0.89 }, { ambiguous: true }, { decision: 'needs_review' }]) {
  test(`review: ambiguous/conditional semantic output fails closed ${JSON.stringify(patch)}`, async () => {
    const f = await ready(); f.setAnalyzer(async input => ({ ...accept(input), ...patch })); const before = snapshot(f.db);
    await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_response_requires_clarification');
    assert.equal(snapshot(f.db), before);
  });
}
test('review: external interpretation runs outside retried transactions and replay does not call it again', async () => {
  const f = await ready(); let depth = 0; const run = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = (...args) => run(async t => { depth += 1; try { return await args[0](t); } finally { depth -= 1; } }, args[1]);
  f.setAnalyzer(async input => { assert.equal(depth, 0); return accept(input); });
  const result = await f.respond(f.prepared); assert.equal(result.capacityReserved, true);
  assert.equal(f.analysisCalls.length, 1); assert.equal((await f.respond(f.prepared)).replayed, true);
  assert.equal(f.analysisCalls.length, 1);
});
test('review: an edited accepted source cannot replay an obsolete confirmation', async () => {
  const f = await ready(); await f.respond(f.prepared); f.db.patch('whatsappMessages', 'MSG-2', { text: 'No, do not change it.' });
  await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_response_conflict');
});
test('review: changed canonical workload invalidates completed acceptance proof even on the same date/time', async () => {
  const f = await ready(); await f.respond(f.prepared);
  f.db.patch('appointments', 'APT-1', { workLines: [{ presetId: 'standard_service', serviceId: 's1', quantity: 5 }] });
  await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_replay_changed');
});
test('review: preparation replay cannot recirculate the offer after newer customer input', async () => {
  const f = await fixture(); await f.prepare(); f.db.patch('communicationConversations', CONV, { customerInputVersion: 5 });
  await assert.rejects(() => f.prepare(), error => error.code === 'recovery_customer_turn_changed');
});
for (const [label, mutate, code] of [
  ['allowlist removed', f => f.db.patch('businessSettings', 'customer-agent', { autoReplyAllowlist: [] }), 'recovery_pilot_blocked'],
  ['operator takes over', f => f.db.patch('communicationConversations', CONV, { aiDisposition: 'human_active' }), 'recovery_pilot_blocked'],
  ['new inbound version', f => f.db.patch('communicationConversations', CONV, { customerInputVersion: 6 }), 'recovery_stale_response'],
  ['source edit', f => f.db.patch('whatsappMessages', 'MSG-2', { text: 'Yes, please move it to Tuesday. But only if it is free.' }), 'recovery_stale_response'],
  ['expiry during analysis', f => f.setTime(new Date(NOW.getTime() + 31 * 60_000)), 'recovery_offer_expired'],
  ['reschedule switch off', f => f.db.patch('businessSettings', 'customer-agent', { autoRescheduleEnabled: false }), 'recovery_reschedule_disabled'],
  ['work becomes occupied', f => f.db.patch('bookingCapacityLocks', f.targetLocks[0].id, { active: true, appointmentId: 'FOREIGN' }), 'recovery_capacity_unavailable'],
]) {
  test(`review: ${label} during model analysis prevents any appointment commit`, async () => {
    const f = await ready(); f.db.writes.length = 0;
    f.setAnalyzer(async input => { mutate(f); return accept(input); });
    await assert.rejects(() => f.respond(f.prepared), error => error.code === code);
    assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
    assert.equal(f.db.read('bookingCapacityLocks', f.originalLocks[0].id).active, true);
    assert.equal(f.db.writes.length, 0);
  });
}
test('review: final write failure after successful external analysis rolls back all canonical changes', async () => {
  const f = await ready(); const before = snapshot(f.db);
  f.setAnalyzer(async input => { f.db.failCommit = true; return accept(input); });
  await assert.rejects(() => f.respond(f.prepared), /Simulated atomic commit failure/);
  assert.equal(f.analysisCalls.length, 1); assert.equal(snapshot(f.db), before);
});
for (const [label, collection, id, patch] of [
  ['not sent', 'whatsappOutboundQueue', 'QUEUE-OUT-1', { status: 'queued' }],
  ['wrong account', 'whatsappOutboundQueue', 'QUEUE-OUT-1', { communicationAccountId: 'other-account' }],
  ['human class', 'whatsappOutboundQueue', 'QUEUE-OUT-1', { outboundClass: 'conversation_human' }],
  ['wrong version', 'whatsappOutboundQueue', 'QUEUE-OUT-1', { recoveryOfferVersion: 99 }],
  ['wrong offer', 'whatsappOutboundQueue', 'QUEUE-OUT-1', { recoveryOfferId: 'OTHER-OFFER' }],
  ['edited message', 'whatsappMessages', 'OUT-1', { text: 'A different appointment was offered.' }],
  ['inbound origin', 'whatsappMessages', 'OUT-1', { direction: 'inbound' }],
  ['wrong provider message', 'whatsappMessages', 'OUT-1', { providerMessageId: 'someone-else' }],
]) {
  test(`review: delivery proof rejects ${label} before semantic analysis`, async () => {
    const f = await ready(); f.db.patch(collection, id, patch); const before = snapshot(f.db);
    await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_delivery_unproven');
    assert.equal(f.analysisCalls.length, 0); assert.equal(snapshot(f.db), before);
  });
}
test('review: one cancelled opening cannot have two concurrent live offer identities', async () => {
  const f = await fixture(); const p = await f.prepare();
  f.db.patch('appointments', 'APT-2', { ...f.db.read('appointments', 'APT-1'), appointmentId: 'APT-2' });
  const recorded = await createCustomerBookingInterestTools({ db: f.db, clock: () => NOW }).record({ action: 'register', kind: 'earlier_appointment',
    customerId: 'C-1', propertyId: 'P-1', appointmentId: 'APT-2', sourceQuote: 'Can you come earlier?', dateFrom: '', dateTo: '' },
  { conversationId: CONV, inboundMessageId: 'MSG-1' });
  await assert.rejects(() => f.service.prepare({ cancelledAppointmentId: 'CANCEL-1', caseId: recorded.caseId }),
    error => error.code === 'recovery_offer_already_pending');
  assert.equal(f.db.read('bookingOffers', p.offerId).version, 1);
  assert.equal(f.db.read('bookingOffers', p.offerId).recovery.appointmentId, 'APT-1');
});
