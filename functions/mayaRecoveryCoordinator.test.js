'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, NOW, CONV, PHONE, SECOND_CONV } = require('./test-support/mayaRecoveryCoordinatorFixture');
const { createMayaRecoveryOfferService } = require('./mayaRecoveryOfferService');
const { configuredAutomation, nextContactTime } = require('./mayaRecoveryAutomationPolicy');

async function started(f) {
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.status, 'waiting_reply', JSON.stringify(result));
  return f.offer();
}
for (const key of ['recoveryAutomationEnabled', 'recoveryOffersEnabled', 'recoveryOutreachEnabled',
  'recoveryResponseRoutingEnabled', 'recoveryConfirmationEnabled', 'autoRescheduleEnabled', 'autoReplyEnabled']) {
  test(`disabled ${key} causes no scan, queue or orchestration write`, async () => {
    const f = await setup(); f.db.patch('businessSettings', 'customer-agent', { [key]: false });
    const before = JSON.stringify([...f.db.docs]);
    assert.equal((await f.coordinator.scheduleCancellation(f.payload)).scheduled, false);
    assert.equal((await f.coordinator.run(f.payload)).processed, false);
    assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.analyses.length, 0); assert.equal(f.tasks.length, 0);
  });
}
test('canonical history -> real scheduling compatibility -> one governed offer queue, original appointment unchanged', async () => {
  const f = await setup();
  const original = JSON.stringify(f.db.read('appointments', 'APT-1'));
  const offer = await started(f);
  assert.equal(offer.recovery.conversationId, CONV); assert.equal(offer.options[0].date, '2026-09-08');
  assert.equal(f.outgoing().length, 1); assert.equal(f.analyses.length, 1);
  assert.equal(f.state().history.length, 1); assert.equal(f.state().history[0].offerVersion, offer.version);
  assert.equal(f.tasks.at(-1).scheduling.scheduleDelaySeconds, 1801);
  assert.equal(JSON.stringify(f.db.read('appointments', 'APT-1')), original);
  assert.equal(f.db.read('bookingCapacityLocks', f.originalLocks[0].id).active, true);
  assert.equal(f.db.read('bookingCapacityLocks', f.targetLocks[0].id).active, false);
});
test('duplicate task resumes the recorded pending offer without another model or message', async () => {
  const f = await setup(); const first = await started(f); await started(f);
  assert.equal(f.offer().version, first.version); assert.equal(f.outgoing().length, 1);
  assert.equal(f.state().history.length, 1); assert.equal(f.analyses.length, 1);
});
test('configured oldest verified request wins instead of first scanned conversation', async () => {
  const f = await setup({ second: true, secondOlder: true }); const offer = await started(f);
  assert.equal(offer.recovery.conversationId, SECOND_CONV); assert.equal(f.analyses.length, 2);
});
test('discovers an earlier request from a selected conversation that had no waiting record', async () => {
  const f = await setup({ second: true, secondOlder: true, secondUnrecorded: true });
  const offer = await started(f);
  assert.equal(offer.recovery.conversationId, SECOND_CONV);
  assert.equal(f.db.read('communicationCases', offer.recovery.caseId).state, 'WAITING');
  assert.equal(f.db.read('appointments', 'APT-2').date, '2026-09-11');
});
test('expiry advances to another candidate without recontacting the same conversation or moving either booking', async () => {
  const f = await setup({ second: true }); const first = await started(f);
  f.setClock(new Date(NOW.getTime() + 31 * 60000)); const second = await started(f);
  assert.equal(second.version, first.version + 1);
  assert.notEqual(second.recovery.conversationId, first.recovery.conversationId);
  assert.equal(f.state().history[0].outcome, 'expired'); assert.equal(f.outgoing().length, 2);
  assert.equal(f.db.read('communicationConversations', first.recovery.conversationId).mayaRecoveryOffer, null);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(f.db.read('appointments', 'APT-2').date, '2026-09-11');
});
test('uncertain attempted send stops the sequence at expiry instead of blindly reoffering', async () => {
  const f = await setup({ second: true }); const offer = await started(f);
  f.db.patch('whatsappOutboundQueue', offer.recovery.outbound.queueId, { status: 'processing', attempts: 1, processingStartedAt: NOW.toISOString() });
  f.setClock(new Date(NOW.getTime() + 31 * 60000)); const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'recovery_automation_delivery_uncertain'); assert.equal(f.outgoing().length, 1);
});
test('maximum offers is a hard limit and history is not silently truncated to contact more people', async () => {
  const f = await setup({ second: true }); const settings = f.db.read('businessSettings', 'customer-agent');
  f.db.patch('businessSettings', 'customer-agent', { recoveryAutomationPolicy: { ...settings.recoveryAutomationPolicy, maxOffers: 1 } });
  await started(f); f.setClock(new Date(NOW.getTime() + 31 * 60000));
  assert.equal((await f.coordinator.run(f.payload)).reason, 'configured_offer_limit');
  assert.equal(f.outgoing().length, 1); assert.equal(f.state().history.length, 1);
});
test('candidate scan overflow cannot be presented as a completed priority scan', async () => {
  const f = await setup({ second: true }); const settings = f.db.read('businessSettings', 'customer-agent');
  f.db.patch('businessSettings', 'customer-agent', { recoveryAutomationPolicy: { ...settings.recoveryAutomationPolicy, maxCases: 1 } });
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'candidate_scan_limit'); assert.equal(f.outgoing().length, 0);
});
test('outside configured Aruba contact hours defers without creating an offer or calling the model', async () => {
  const f = await setup(); const settings = f.db.read('businessSettings', 'customer-agent');
  f.db.patch('businessSettings', 'customer-agent', { recoveryContactPolicy: { ...settings.recoveryContactPolicy,
    windows: [{ weekday: 1, start: '08:00', end: '17:00' }] } });
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.status, 'waiting_contact'); assert.equal(f.tasks[0].scheduling.scheduleDelaySeconds, 3600);
  assert.equal(f.analyses.length, 0); assert.equal(f.outgoing().length, 0);
  f.setClock(new Date(NOW.getTime() + 3600000)); await started(f);
});
test('old cancellation and forged generation cannot activate history review or outreach', async () => {
  const f = await setup();
  assert.equal((await f.coordinator.run({ ...f.payload, generation: 'a'.repeat(64) })).reason, 'recovery_automation_generation_changed');
  const settings = f.db.read('businessSettings', 'customer-agent');
  f.db.patch('businessSettings', 'customer-agent', { recoveryAutomationPolicy: { ...settings.recoveryAutomationPolicy, activeSince: NOW.toISOString() } });
  assert.equal((await f.coordinator.run(f.payload)).reason, 'recovery_automation_historical_cancellation');
  assert.equal(f.analyses.length, 0); assert.equal(f.db.writes.length, 0);
});
test('ambiguous duplicate chats for a selected number require review rather than choosing one', async () => {
  const f = await setup(); f.db.patch('communicationConversations', `COMM-${'A'.repeat(40)}`, { ...f.db.read('communicationConversations', CONV) });
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'duplicate_selected_phone_conversations'); assert.equal(f.analyses.length, 0); assert.equal(f.outgoing().length, 0);
});
test('unselected conversations are not sent to the history model', async () => {
  const f = await setup();
  f.db.patch('communicationConversations', 'FOREIGN-CONVERSATION', { ...f.db.read('communicationConversations', CONV), phone: '2975999999', recentMessages: [{ id: 'PRIVATE-MESSAGE' }] });
  await started(f);
  assert.equal(f.analyses.length, 1); assert.equal(f.db.reads.includes('whatsappMessages/PRIVATE-MESSAGE'), false);
});
test('losing the prepare result resumes the atomically recorded offer, not a new version', async () => {
  let fail = true;
  const f = await setup({ offerFactory: options => {
    const service = createMayaRecoveryOfferService(options);
    return { prepare: async input => { const result = await service.prepare(input); if (fail) { fail = false; throw new Error('simulated lost prepare result'); } return result; } };
  } });
  await assert.rejects(() => f.coordinator.run(f.payload), /lost prepare result/);
  assert.equal(f.state().history.length, 1); assert.equal(f.outgoing().length, 0);
  await started(f); assert.equal(f.offer().version, 1); assert.equal(f.outgoing().length, 1);
});
test('task scheduling failure after queue publication resumes without a duplicate customer message', async () => {
  let fail = true;
  const f = await setup({ onEnqueue: () => { if (fail) { fail = false; throw new Error('simulated task transport failure'); } } });
  await assert.rejects(() => f.coordinator.run(f.payload), /task transport failure/);
  assert.equal(f.outgoing().length, 1); await started(f);
  assert.equal(f.outgoing().length, 1); assert.equal(f.analyses.length, 1);
});
test('policy revocation during history analysis prevents its final write and any offer', async () => {
  const f = await setup({ onReview: current => current.db.patch('businessSettings', 'customer-agent', { recoveryAutomationEnabled: false }) });
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.processed, false); assert.equal(f.outgoing().length, 0); assert.equal(f.state().history.length, 0);
});
test('an expired/superseded worker cannot commit through a newer worker lease', async () => {
  const f = await setup({ onReview: current => {
    const state = current.db.read('appointments', 'CANCEL-1').mayaRecoveryAutomation;
    current.db.patch('appointments', 'CANCEL-1', { mayaRecoveryAutomation: { ...state, leaseToken: 'replacement-worker' } });
  } });
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'recovery_automation_stale_worker');
  assert.equal(f.state().leaseToken, 'replacement-worker'); assert.equal(f.outgoing().length, 0);
});
test('atomic storage failure cannot leave a partial run or touch the schedule', async () => {
  const f = await setup(); const before = JSON.stringify([...f.db.docs]); f.db.failCommit = true;
  await assert.rejects(() => f.coordinator.run(f.payload), /atomic commit failure/);
  assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('policy accepts only explicit supported priority and bounded selected-phone scope', async () => {
  const f = await setup(); const settings = f.db.read('businessSettings', 'customer-agent');
  assert.equal(configuredAutomation(settings, NOW).policy.ranking, 'oldest_verified_request');
  for (const patch of [{ ranking: 'highest_price' }, { maxConversations: 0 }, { maxCases: 51 }, { maxOffers: 11 }, { activeSince: '2099-01-01T00:00:00Z' }]) {
    assert.throws(() => configuredAutomation({ ...settings, recoveryAutomationPolicy: { ...settings.recoveryAutomationPolicy, ...patch } }, NOW));
  }
  assert.throws(() => configuredAutomation({ ...settings, autoReplyAllowlist: [] }, NOW));
});
test('next contact time uses Aruba date across UTC midnight and excludes the end boundary', () => {
  const policy = { windows: [{ weekday: 1, start: '20:00', end: '21:00' }, { weekday: 2, start: '08:00', end: '09:00' }] };
  assert.equal(nextContactTime(policy, new Date('2026-09-08T00:30:00Z')).toISOString(), '2026-09-08T00:30:00.000Z');
  assert.equal(nextContactTime(policy, new Date('2026-09-08T01:00:00Z')).toISOString(), '2026-09-08T12:00:00.000Z');
});
