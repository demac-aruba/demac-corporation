'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW, CONV, PHONE, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryConfirmation, confirmationQueueId, ordinaryReplyId, completionPin,
  renderConfirmation, recoveryConfirmationClaimDecision } = require('./mayaRecoveryConfirmation');
const { sessionIdentity } = require('./demacCustomerConversationState');
const AT = new Date(NOW.getTime() + 180000);
const context = () => ({ conversationId: CONV, inboundMessageId: 'MSG-2', communicationAccountId: ACCOUNT,
  expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 });
async function setup(accepted = true) {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: true, recoveryConfirmationEnabled: true });
  const offer = await f.prepare(); await f.delivered(offer); f.inbound();
  if (accepted) await f.respond(offer);
  const confirmation = createMayaRecoveryConfirmation({ db: f.db, clock: () => AT });
  f.db.writes.length = 0;
  return { ...f, offer, confirmation };
}
function scheduling(db) {
  return JSON.stringify([...db.docs].filter(([key]) => /^(appointments|workOrders|bookingCapacityLocks)\//.test(key)));
}

test('completion pointer commits with the canonical move and matches the exact response', async () => {
  const f = await setup(); const offer = { ...f.db.read('bookingOffers', f.offer.offerId), id: f.offer.offerId };
  assert.deepEqual(f.db.read('whatsappMessages', 'MSG-2').mayaRecoveryCompletion, completionPin(offer));
});
test('recovering a committed move is read-only and uses canonical date/time, not another model call', async () => {
  const f = await setup(); const before = JSON.stringify([...f.db.docs]); let calls = 0;
  const result = await f.confirmation.runWithRecovery({ context: context(), run: async () => { calls++; throw new Error('Should not run'); } });
  assert.equal(calls, 0); assert.equal(result.metadata.outcome, 'appointment_rescheduled');
  assert.equal(result.metadata.appointmentId, 'APT-1'); assert.match(result.draft, /2026-09-08.*09:30/);
  assert.equal(JSON.stringify([...f.db.docs]), before); assert.deepEqual(f.db.writes, []);
});
test('failure after a real canonical acceptance recovers the result without a second mutation', async () => {
  const f = await setup(false); let calls = 0;
  const result = await f.confirmation.runWithRecovery({ context: context(), run: async () => {
    calls++; await f.respond(f.offer); throw new Error('Synthetic final model failure');
  } });
  assert.equal(calls, 1); assert.equal(f.analysisCalls.length, 1); assert.equal(result.metadata.appointmentId, 'APT-1');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  const before = scheduling(f.db); await f.confirmation.runWithRecovery({ context: context(), run: () => assert.fail('Repeated mutation') });
  assert.equal(scheduling(f.db), before); assert.equal(f.analysisCalls.length, 1);
});
test('failure before commitment never generates a successful confirmation', async () => {
  const f = await setup(false); const error = new Error('Before mutation');
  await assert.rejects(f.confirmation.runWithRecovery({ context: context(), run: async () => { throw error; } }), error);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(await f.confirmation.enqueueIfCompleted({ context: context() }), null);
});
test('successful but invented model prose is replaced with canonical confirmation', async () => {
  const f = await setup(false);
  const result = await f.confirmation.runWithRecovery({ context: context(), run: async () => {
    await f.respond(f.offer); return { draft: 'Friday at 08:00 is confirmed', metadata: { outcome: 'reply' } };
  } });
  assert.match(result.draft, /2026-09-08.*09:30/); assert.doesNotMatch(result.draft, /Friday|08:00/);
});
test('same-source confirmation enqueues once and updates the existing session atomically without scheduling writes', async () => {
  const f = await setup(); const schedule = scheduling(f.db);
  const first = await f.confirmation.enqueueIfCompleted({ context: context(), result: { draft: 'Wrong date' } });
  assert.equal(first.queued, true); assert.equal(first.id, confirmationQueueId(CONV, 'MSG-2'));
  const queue = f.db.read('whatsappOutboundQueue', first.id);
  assert.equal(queue.to, PHONE); assert.equal(queue.status, 'queued'); assert.match(queue.text, /2026-09-08/);
  assert.equal(queue.sourceInboundMessageId, 'MSG-2'); assert.equal(queue.recoveryConfirmation.version, 1);
  const id = sessionIdentity({ conversationId: CONV, provider: 'wacli', communicationAccountId: ACCOUNT }).sessionId;
  assert.equal(f.db.read('customerAgentSessions', id).lastOutcome, 'appointment_rescheduled');
  assert.equal(f.db.read('customerAgentSessions', id).appointmentId, 'APT-1');
  const snapshot = JSON.stringify([...f.db.docs]); f.db.writes.length = 0;
  const second = await f.confirmation.enqueueIfCompleted({ context: context() });
  assert.equal(second.existing, true); assert.equal(second.id, first.id);
  assert.equal(JSON.stringify([...f.db.docs]), snapshot); assert.deepEqual(f.db.writes, []);
  assert.equal(scheduling(f.db), schedule);
});
test('a failed confirmation queue commit leaves the already moved appointment unchanged and no partial reply/session', async () => {
  const f = await setup(); const before = JSON.stringify([...f.db.docs]);
  f.db.failCommit = true;
  await assert.rejects(f.confirmation.enqueueIfCompleted({ context: context() }), /Simulated atomic commit failure/);
  assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  f.db.failCommit = false; assert.equal((await f.confirmation.enqueueIfCompleted({ context: context() })).queued, true);
});
test('a different already queued reply for the same source requires reconciliation, not a second message', async () => {
  const f = await setup(); f.db.patch('whatsappOutboundQueue', ordinaryReplyId(CONV, 'MSG-2'), { status: 'queued', text: 'Other reply' });
  await assert.rejects(f.confirmation.enqueueIfCompleted({ context: context() }), { code: 'recovery_confirmation_other_reply_exists' });
  assert.equal(f.db.read('whatsappOutboundQueue', confirmationQueueId(CONV, 'MSG-2')), undefined);
});
const invalidations = [
  ['confirmation permission', f => f.db.patch('businessSettings', 'customer-agent', { recoveryConfirmationEnabled: false })],
  ['routing permission', f => f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: false })],
  ['selected phone removed', f => f.db.patch('businessSettings', 'customer-agent', { autoReplyAllowlist: [] })],
  ['global disable', f => f.db.patch('businessSettings', 'customer-agent', { enabled: false })],
  ['reply disable', f => f.db.patch('businessSettings', 'customer-agent', { autoReplyEnabled: false })],
  ['operator takeover', f => f.db.patch('communicationConversations', CONV, { ownerUserId: 'synthetic-operator', aiDisposition: 'human_active' })],
  ['newer customer turn', f => f.db.patch('communicationConversations', CONV, { customerInputVersion: 6 })],
  ['removed offer pointer', f => f.db.patch('communicationConversations', CONV, { mayaRecoveryOffer: null })],
  ['changed account', f => f.db.patch('businessSettings', 'whatsapp', { communicationAccountId: 'another-account' })],
  ['source edit', f => f.db.patch('whatsappMessages', 'MSG-2', { text: 'No, leave it Thursday.' })],
  ['property reassignment', f => f.db.patch('properties', 'P-1', { clientId: 'OTHER' })],
  ['inactive customer', f => f.db.patch('clients', 'C-1', { active: false })],
  ['changed appointment date', f => f.db.patch('appointments', 'APT-1', { date: '2026-09-09' })],
  ['cancelled appointment', f => f.db.patch('appointments', 'APT-1', { status: 'cancelled' })],
  ['released target capacity', f => f.db.patch('bookingCapacityLocks', f.targetLocks[0].id, { active: false })],
  ['foreign work order', f => f.db.patch('workOrders', 'WO-APT-1-1', { appointmentId: 'OTHER' })],
  ['modified fulfillment', f => f.db.patch('communicationCases', f.caseId, { state: 'WAITING' })],
  ['changed offered-message proof', f => f.db.patch('whatsappMessages', 'OUT-1', { text: 'An unrelated message' })],
];
for (const [name, invalidate] of invalidations) {
  test(`${name} prevents stale confirmation at enqueue and at the final claim`, async () => {
    const f = await setup(); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
    invalidate(f); const schedule = scheduling(f.db); f.db.writes.length = 0;
    await assert.rejects(f.confirmation.enqueueIfCompleted({ context: context() }));
    const decision = await f.db.runTransaction(transaction => recoveryConfirmationClaimDecision({ db: f.db, transaction,
      queueId: queued.id, queueItem: f.db.read('whatsappOutboundQueue', queued.id), now: AT }));
    assert.equal(decision.allowed, false); assert.equal(scheduling(f.db), schedule); assert.deepEqual(f.db.writes, []);
  });
}
test('a committed move stays confirmed when mutation autonomy is subsequently disabled; sending has its own permission', async () => {
  const f = await setup(); f.db.patch('businessSettings', 'customer-agent', { autoRescheduleEnabled: false });
  const before = scheduling(f.db); assert.equal((await f.confirmation.recover(context())).metadata.appointmentId, 'APT-1');
  assert.equal(scheduling(f.db), before);
});
test('ordinary turns, pending offers and explicit declines retain the normal result instead of invented completion', async () => {
  const f = await setup(false); const ordinary = { draft: 'Please clarify.', metadata: { outcome: 'reply' } };
  assert.equal(await f.confirmation.runWithRecovery({ context: context(), run: async () => ordinary }), ordinary);
  f.db.patch('whatsappMessages', 'MSG-2', { text: 'No, keep Thursday.' });
  await f.respond(f.offer, 'decline', 'No, keep Thursday.');
  assert.equal(await f.confirmation.recover(context()), null);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'WAITING');
});
test('a fake confirmation marker without canonical completion cannot enter the ordinary reply path', async () => {
  const f = await setup(false);
  await assert.rejects(f.confirmation.enqueueIfCompleted({ context: context(), result: { metadata: { recoveryConfirmation: { version: 1 } } } }),
    { code: 'recovery_confirmation_completion_missing' });
});
test('another source or conflicting expected input epoch cannot reuse a previous committed confirmation', async () => {
  const f = await setup();
  assert.equal(await f.confirmation.recover({ ...context(), inboundMessageId: 'UNRELATED' }), null);
  await assert.rejects(f.confirmation.recover({ ...context(), expectedCustomerInputVersion: 6 }));
});
test('confirmation languages and dates are explicit, never a guessed schedule or unreviewed language fallback', () => {
  assert.equal(renderConfirmation({ date: '2026-09-08', startTime: '09:30' }, 'es'),
    'Tu cita quedó adelantada al *2026-09-08* a las *09:30* (hora de Aruba).');
  assert.throws(() => renderConfirmation({ date: '2026-02-30', startTime: '09:30' }, 'en'));
  assert.throws(() => renderConfirmation({ date: '2026-09-08', startTime: '09:30' }, 'pap-aw'));
});
test('database failures propagate instead of falling back to an unverified model confirmation', async () => {
  const f = await setup(); const old = f.db.runTransaction.bind(f.db); let calls = 0;
  f.db.runTransaction = async () => { throw new Error('Synthetic storage outage'); };
  await assert.rejects(f.confirmation.runWithRecovery({ context: context(), run: async () => { calls++; return {}; } }), /Synthetic storage outage/);
  assert.equal(calls, 0); f.db.runTransaction = old;
});
