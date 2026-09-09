'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-automation-review', storageBucket: 'demo-maya-automation-review.appspot.com' });
const { setup, NOW, ACCOUNT } = require('./test-support/mayaRecoveryCoordinatorFixture');
const { createMayaRecoveryOfferOutbound } = require('./mayaRecoveryOfferOutbound');
const { createMayaRecoveryOfferService } = require('./mayaRecoveryOfferService');
const { taskIdentity } = require('./mayaRecoveryCoordinator');
const gateway = require('./whatsappWacliGateway');
const P = require('./mayaRecoveryOfferPolicy');
async function started(f) {
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.status, 'waiting_reply', JSON.stringify(result));
  return f.offer();
}
function domainState(f) {
  return JSON.stringify([...f.db.docs].filter(([path]) => path.startsWith('appointments/')
    || path.startsWith('workOrders/') || path.startsWith('bookingCapacityLocks/'))
    .map(([path, value]) => { const copy = { ...value }; delete copy.mayaRecoveryAutomation; return [path, copy]; }));
}
for (const removal of ['offer', 'cancellation', 'both']) {
  test(`removing ${removal} automation provenance cannot bypass the actual outbound claim`, async () => {
    const f = await setup(); const offer = await started(f);
    if (removal !== 'cancellation') {
      const r = { ...offer.recovery }; delete r.automation;
      f.db.patch('bookingOffers', offer.id, { recovery: r });
    }
    if (removal !== 'offer') {
      const a = { ...f.db.read('appointments', 'CANCEL-1') }; delete a.mayaRecoveryAutomation;
      f.db.docs.set('appointments/CANCEL-1', a);
    }
    const before = domainState(f);
    assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, NOW.getTime()), null);
    assert.equal(f.db.read('whatsappOutboundQueue', offer.recovery.outbound.queueId).status, 'failed');
    assert.equal(domainState(f), before);
  });
}
test('changing the approved policy after publication prevents the real claim, even with outreach otherwise enabled', async () => {
  const f = await setup(); const offer = await started(f);
  const s = f.db.read('businessSettings', 'customer-agent');
  f.db.patch('businessSettings', 'customer-agent', { recoveryAutomationPolicy: { ...s.recoveryAutomationPolicy, maxOffers: 4 } });
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, NOW.getTime()), null);
  assert.equal(f.db.read('whatsappOutboundQueue', offer.recovery.outbound.queueId).status, 'failed');
});
test('lost queued document is not interpreted as an unsent offer that may be superseded', async () => {
  const f = await setup({ second: true }); const offer = await started(f);
  f.db.docs.delete(`whatsappOutboundQueue/${offer.recovery.outbound.queueId}`);
  f.setClock(new Date(NOW.getTime() + 31 * 60000));
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'recovery_automation_lost_queue');
  assert.equal(f.state().history.length, 1); assert.equal(f.offer().version, 1);
});
test('a status of sent without canonical delivery proof cannot continue the sequence after expiry', async () => {
  const f = await setup({ second: true }); const offer = await started(f);
  f.db.patch('whatsappOutboundQueue', offer.recovery.outbound.queueId, { status: 'sent', messageId: 'UNPROVEN-SEND' });
  f.setClock(new Date(NOW.getTime() + 31 * 60000));
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'recovery_delivery_unproven');
  assert.equal(f.outgoing().length, 1); assert.equal(f.state().history[0].outcome, 'pending');
});
test('malformed accepted state does not report an opening as filled or issue another offer', async () => {
  const f = await setup({ second: true }); const offer = await started(f);
  f.db.patch('bookingOffers', offer.id, { status: 'booked', recovery: { ...offer.recovery, state: 'accepted', response: { decision: 'decline' } } });
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'recovery_automation_result_unproven');
  assert.equal(f.outgoing().length, 1); assert.equal(f.db.read('appointments', offer.recovery.appointmentId).date === '2026-09-08', false);
});
test('cancellation scheduling fields changed between task generations stop the old worker', async () => {
  const f = await setup(); const offer = await started(f);
  f.db.patch('appointments', 'CANCEL-1', { startTime: '10:30' });
  const before = domainState(f);
  assert.equal((await f.coordinator.run(f.payload)).reason, 'recovery_automation_generation_changed');
  assert.equal(f.offer().version, offer.version); assert.equal(domainState(f), before);
});
test('a failed task enqueue from a cancellation handler path propagates for platform retry', async () => {
  const f = await setup({ onEnqueue: () => { throw new Error('offline task transport unavailable'); } });
  const before = JSON.stringify([...f.db.docs]);
  await assert.rejects(() => f.coordinator.scheduleCancellation(f.payload), /task transport unavailable/);
  assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.outgoing().length, 0);
});
test('an already busy worker only schedules a bounded later wake, without another history/model pass', async () => {
  let nested; let f;
  f = await setup({ onReview: async (_, __, count) => { if (count === 1) nested = await f.coordinator.run(f.payload); } });
  await started(f);
  assert.equal(nested.reason, 'worker_busy'); assert.equal(f.analyses.length, 1); assert.equal(f.outgoing().length, 1);
  assert.equal(f.tasks[0].scheduling.scheduleDelaySeconds, 241);
  assert.deepEqual(f.tasks[0].payload, f.payload);
});
test('an offer-prepare commit and its cancellation receipt cannot be partially persisted', async () => {
  const f = await setup(); const before = domainState(f);
  const run = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = (callback, options) => run(raw => callback({ get: raw.get.bind(raw), set(ref, value, writeOptions) {
    if (ref.path === 'appointments/CANCEL-1' && value.mayaRecoveryAutomation?.history.length === 1) {
      throw new Error('simulated orchestration receipt write failure');
    }
    return raw.set(ref, value, writeOptions);
  } }), options);
  await assert.rejects(() => f.coordinator.run(f.payload), /receipt write failure/);
  assert.equal(f.db.read('bookingOffers', P.recoveryOfferId(ACCOUNT, 'CANCEL-1')), undefined);
  assert.equal(f.state().history.length, 0); assert.equal(f.outgoing().length, 0); assert.equal(domainState(f), before);
});
test('an interrupted preparation that expires before enqueue does not later send that obsolete offer', async () => {
  let fail = true;
  const f = await setup({ second: true, offerFactory: options => {
    const service = createMayaRecoveryOfferService(options);
    return { prepare: async args => { const result = await service.prepare(args); if (fail) { fail = false; throw new Error('lost preparation result'); } return result; } };
  } });
  await assert.rejects(() => f.coordinator.run(f.payload), /lost preparation result/);
  const first = f.offer(); assert.equal(f.outgoing().length, 0);
  f.setClock(new Date(NOW.getTime() + 31 * 60000)); const second = await started(f);
  assert.equal(second.version, first.version + 1); assert.notEqual(second.recovery.conversationId, first.recovery.conversationId);
  assert.equal(f.outgoing().length, 1); assert.equal(f.state().history[0].outcome, 'expired');
});
test('full source edit between preparation and enqueue cannot authorize outreach', async () => {
  let f;
  f = await setup({ outboundFactory: options => {
    const service = createMayaRecoveryOfferOutbound(options);
    return { enqueue: args => {
      const r = f.offer().recovery; const record = f.db.read('communicationCases', r.caseId);
      const source = f.db.read('whatsappMessages', record.lastSourceMessageId);
      f.db.patch('whatsappMessages', record.lastSourceMessageId, { text: `${source.text} Actually, do not move my appointment.` });
      return service.enqueue(args);
    } };
  } });
  const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'recovery_interest_requires_review');
  assert.equal(f.outgoing().length, 0); assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
});
test('reoccupied target before candidate selection yields no fabricated free slot', async () => {
  const f = await setup();
  f.db.patch('bookingCapacityLocks', f.targetLocks[0].id, { active: true, appointmentId: 'ANOTHER-REAL-OWNER' });
  const before = domainState(f); const result = await f.coordinator.run(f.payload);
  assert.equal(result.reason, 'no_compatible_candidate'); assert.equal(f.outgoing().length, 0);
  assert.equal(domainState(f), before);
});
test('task payload cannot supply customer IDs, phone, text, arbitrary policy or a new offer identity', () => {
  const valid = { cancelledAppointmentId: 'CANCEL-1', generation: 'a'.repeat(64) };
  assert.deepEqual(taskIdentity(valid), valid);
  for (const key of ['customerId', 'phone', 'text', 'offerId', 'policy']) assert.throws(() => taskIdentity({ ...valid, [key]: 'untrusted' }));
  assert.throws(() => taskIdentity({ ...valid, cancelledAppointmentId: '../OTHER' }));
  assert.throws(() => taskIdentity({ ...valid, generation: 'wrong' }));
});
