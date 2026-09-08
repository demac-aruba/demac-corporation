'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW, CONV } = require('./test-support/mayaRecoveryOffersFixture');
const { validateOfferSelection } = require('./bookingAuthorityCore');
const { isOpen } = require('./mayaRecoveryOfferPolicy');
const schedule = db => JSON.stringify([...db.docs].filter(([path]) => /^(appointments|workOrders|bookingCapacityLocks)\//.test(path)));

async function ready() {
  const f = await fixture(); const prepared = await f.prepare(); await f.delivered(prepared); f.inbound();
  return { ...f, prepared };
}
test('preparing a real canonical offer does not reserve capacity, write outbound queues or change Thursday', async () => {
  const f = await fixture(); const before = schedule(f.db); const p = await f.prepare();
  assert.equal(p.state, 'prepared'); assert.equal(p.date, '2026-09-08'); assert.equal(p.capacityReserved, false);
  assert.equal(schedule(f.db), before);
  assert.deepEqual(f.db.writes.sort(), [`bookingOffers/${p.offerId}`, `communicationConversations/${CONV}`].sort());
  assert.match(p.messageText, /subject to availability/);
  assert.equal(f.db.read('bookingOffers', p.offerId).status, 'recovery_pending');
});
test('ordinary appointment creation cannot consume a pending recovery offer', async () => {
  const f = await fixture(); const p = await f.prepare(); const offer = f.db.read('bookingOffers', p.offerId);
  assert.throws(() => validateOfferSelection({ offer, offerVersion: p.offerVersion, optionId: offer.options[0].id, now: NOW }), error => error.code === 'offer_not_open');
});
test('preparation replay keeps a single version and does not repeat writes', async () => {
  const f = await fixture(); const first = await f.prepare(); f.db.writes.length = 0;
  const replay = await f.prepare(); assert.equal(replay.replayed, true); assert.equal(replay.offerVersion, first.offerVersion);
  assert.equal(replay.offerId, first.offerId); assert.equal(f.db.writes.length, 0);
});
test('acceptance changes Thursday to Tuesday through canonical lifecycle and releases only the old capacity', async () => {
  const f = await ready(); const result = await f.respond(f.prepared);
  assert.equal(result.success, true); assert.equal(result.state, 'accepted'); assert.equal(result.changeKind, 'customer_reschedule');
  const appointment = f.db.read('appointments', 'APT-1');
  assert.equal(appointment.date, '2026-09-08'); assert.equal(appointment.startTime, '09:30');
  assert.equal(f.db.read('bookingCapacityLocks', f.originalLocks[0].id).active, false);
  assert.equal(f.db.read('bookingCapacityLocks', f.targetLocks[0].id).active, true);
  assert.equal(f.db.read('bookingCapacityLocks', f.targetLocks[0].id).appointmentId, 'APT-1');
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'FULFILLED');
  assert.equal(f.db.read('bookingOffers', f.prepared.offerId).status, 'booked');
  assert.equal(f.db.read('appointments', 'CANCEL-1').status, 'cancelled');
  const order = f.db.read('workOrders', 'WO-APT-1-1');
  assert.equal(order.amount, 125); assert.equal(order.paid, 50); assert.equal(order.reportReference, 'preserve-report');
  assert.deepEqual(order.notificationRecipients, [{ id: 'existing-recipient', sendReminder: true }]);
});
test('declining one offer leaves Thursday AND the general waiting preference intact', async () => {
  const f = await ready(); const before = schedule(f.db); const text = f.inbound('No, keep Thursday.');
  const result = await f.respond(f.prepared, 'decline', text);
  assert.equal(result.state, 'declined'); assert.equal(schedule(f.db), before);
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'WAITING');
});
test('same accepted response replays only while canonical completion remains proven', async () => {
  const f = await ready(); await f.respond(f.prepared); f.db.writes.length = 0;
  assert.equal((await f.respond(f.prepared)).replayed, true); assert.equal(f.db.writes.length, 0);
  f.db.patch('appointments', 'APT-1', { date: '2026-09-11' });
  await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_replay_changed');
});
test('late acceptance cannot remove the original appointment', async () => {
  const f = await ready(); const before = schedule(f.db); f.setTime(new Date(NOW.getTime() + 31 * 60_000));
  await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_offer_expired');
  assert.equal(schedule(f.db), before);
});
test('a newer offer generation rejects responses to the previous version', async () => {
  const f = await fixture(); const p = await f.prepare(); f.setTime(new Date(NOW.getTime() + 31 * 60_000));
  const replacement = await f.prepare(); assert.equal(replacement.offerId, p.offerId); assert.equal(replacement.offerVersion, 2);
  f.inbound(); await assert.rejects(() => f.respond(p), error => error.code === 'recovery_offer_version_changed');
});
test('a prepared offer without proven delivery cannot be accepted', async () => {
  const f = await fixture(); const p = await f.prepare(); f.inbound();
  await assert.rejects(() => f.respond(p), error => error.code === 'recovery_offer_not_delivered');
});
test('an unrelated later outbound question makes a bare affirmation ambiguous', async () => {
  const f = await ready(); const before = schedule(f.db);
  f.db.patch('communicationConversations', CONV, { recentMessages: [{ id: 'OUT-1', role: 'ai' }, { id: 'UNRELATED', role: 'ai' }] });
  await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_response_ambiguous');
  assert.equal(schedule(f.db), before);
});
test('invented response quote is not customer authorization', async () => {
  const f = await ready(); await assert.rejects(() => f.respond(f.prepared, 'accept', 'not in the message'), error => error.code === 'recovery_response_evidence_missing');
});
test('provider-timestamped old replies cannot become acceptance merely by being ingested later', async () => {
  const f = await ready(); f.db.patch('whatsappMessages', 'MSG-2', { whatsappTimestamp: '2026-09-06T10:00:00Z' });
  await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_response_predates_offer');
});
test('a failed final commit leaves offer, waiting preference, old and new capacity exactly unchanged', async () => {
  const f = await ready(); const before = JSON.stringify([...f.db.docs]); f.db.failCommit = true;
  await assert.rejects(() => f.respond(f.prepared), /Simulated atomic commit failure/);
  assert.equal(JSON.stringify([...f.db.docs]), before);
});
for (const [name, collection, id, patch, code] of [
  ['phone revoked', 'businessSettings', 'customer-agent', { autoReplyAllowlist: [] }, 'recovery_pilot_blocked'],
  ['Maya disabled', 'businessSettings', 'customer-agent', { enabled: false }, 'recovery_pilot_blocked'],
  ['reschedule disabled', 'businessSettings', 'customer-agent', { autoRescheduleEnabled: false }, 'recovery_reschedule_disabled'],
  ['offer function disabled', 'businessSettings', 'customer-agent', { recoveryOffersEnabled: false }, 'recovery_offers_disabled'],
  ['human takeover', 'communicationConversations', CONV, { aiDisposition: 'human_active', ownerUserId: 'OP-1' }, 'recovery_pilot_blocked'],
  ['newer input', 'communicationConversations', CONV, { customerInputVersion: 6 }, 'recovery_stale_response'],
  ['changed work', 'appointments', 'APT-1', { workLines: [{ presetId: 'standard_service', serviceId: 's1', quantity: 2 }] }, 'recovery_original_changed'],
  ['changed original date', 'appointments', 'APT-1', { date: '2026-09-12' }, 'recovery_original_changed'],
  ['started work', 'workOrders', 'WO-APT-1-1', { status: 'En progreso' }, 'recovery_original_work_changed'],
]) {
  test(`${name} prevents acceptance without any partial schedule write`, async () => {
    const f = await ready(); f.db.patch(collection, id, patch); const before = schedule(f.db); f.db.writes.length = 0;
    await assert.rejects(() => f.respond(f.prepared), error => error.code === code);
    assert.equal(schedule(f.db), before); assert.equal(f.db.writes.length, 0);
  });
}
test('a reoccupied target fails while Thursday stays reserved', async () => {
  const f = await ready(); f.db.patch('bookingCapacityLocks', f.targetLocks[0].id, { active: true, appointmentId: 'OTHER' });
  const before = schedule(f.db); await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_capacity_unavailable');
  assert.equal(schedule(f.db), before); assert.equal(f.db.read('bookingCapacityLocks', f.originalLocks[0].id).active, true);
});
test('foreign old capacity is never released by the canonical reschedule', async () => {
  const f = await ready(); f.db.patch('bookingCapacityLocks', f.originalLocks[0].id, { appointmentId: 'OTHER' });
  const before = schedule(f.db); await assert.rejects(() => f.respond(f.prepared), error => error.code === 'recovery_original_capacity_changed');
  assert.equal(schedule(f.db), before);
});
test('missing business TTL and unsupported renderer language stop preparation with no writes', async () => {
  for (const patch of [{ recoveryOfferTtlMinutes: undefined }, { recoveryOfferTtlMinutes: '30' }, { recoveryOfferTtlMinutes: 181 }]) {
    const f = await fixture(); f.db.patch('businessSettings', 'customer-agent', patch);
    await assert.rejects(() => f.prepare(), error => error.code === 'recovery_offer_policy_missing'); assert.equal(f.db.writes.length, 0);
  }
  const f = await fixture(); f.db.patch('communicationConversations', CONV, { language: 'pap-aw' });
  await assert.rejects(() => f.prepare(), error => error.code === 'recovery_language_not_supported'); assert.equal(f.db.writes.length, 0);
});
test('recovery pending and an unexpired deadline are both required for usability', () => {
  assert.equal(isOpen({ status: 'open', expiresAt: '2098-12-22T00:00:00Z', recovery: { state: 'sent' } }, NOW), false);
  assert.equal(isOpen({ status: 'recovery_pending', expiresAt: 'invalid', recovery: { state: 'sent' } }, NOW), false);
});
