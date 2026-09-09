'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-automation-tests', storageBucket: 'demo-maya-automation-tests.appspot.com' });
const { getFirestore } = require('firebase-admin/firestore');
const { setup, NOW, ACCOUNT } = require('./test-support/mayaRecoveryCoordinatorFixture');
const { createMayaRecoveryOfferService } = require('./mayaRecoveryOfferService');
const { handleCancellationChange, handleRecoveryOfferChange } = require('./mayaRecoveryAutomation');
const gateway = require('./whatsappWacliGateway');
const TOKEN = 'synthetic-automation-transport-test';
const snapshot = (id, data) => ({ id, exists: Boolean(data), data: () => data });
function cancellationEvent(f, before) {
  return { data: { before: snapshot('CANCEL-1', before), after: snapshot('CANCEL-1', f.db.read('appointments', 'CANCEL-1')) } };
}
async function install(t, options = {}) {
  const f = await setup(options);
  const firestore = getFirestore();
  t.mock.method(firestore, 'collection', name => f.db.collection(name));
  t.mock.method(firestore, 'runTransaction', (...args) => f.db.runTransaction(...args));
  const old = process.env.WACLI_BRIDGE_TOKEN;
  process.env.WACLI_BRIDGE_TOKEN = TOKEN;
  t.after(() => { if (old === undefined) delete process.env.WACLI_BRIDGE_TOKEN; else process.env.WACLI_BRIDGE_TOKEN = old; });
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  f.advance = milliseconds => { const at = f.clock().getTime() + milliseconds; f.setClock(new Date(at)); t.mock.timers.setTime(at); };
  return f;
}
async function start(f) {
  const before = { ...f.db.read('appointments', 'CANCEL-1'), status: 'confirmed', cancelledAtIso: null };
  assert.equal((await handleCancellationChange(cancellationEvent(f, before), f.coordinator)).scheduled, true);
  assert.deepEqual(Object.keys(f.tasks[0].payload).sort(), ['cancelledAppointmentId', 'generation']);
  const result = await f.coordinator.run(f.tasks[0].payload);
  assert.equal(result.status, 'waiting_reply', JSON.stringify(result));
  return f.offer();
}
async function deliver(f) {
  f.advance(1000);
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'synthetic-automation-bridge', ACCOUNT, f.clock().getTime());
  assert.ok(command, 'the actual transport claim must accept the governed automated offer');
  f.advance(1000);
  const headers = { authorization: `Bearer ${TOKEN}`, 'x-demac-communication-account-id': ACCOUNT };
  const req = { method: 'POST', headers, body: { queueId: command.queueId, claimToken: command.claimToken,
    sent: true, messageId: 'synthetic-provider-automation-offer' }, get(name) { return headers[name.toLowerCase()]; } };
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set() { return this; }, on() { return this; } };
  await gateway.wacliOutboundAck(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.recoveryDeliveryBound, true, JSON.stringify(res.body));
  return f.offer();
}
async function respond(f, decision) {
  f.advance(1000);
  const offer = f.offer(); const r = offer.recovery; const id = 'AUTOMATION-REPLY';
  const text = decision === 'accept' ? 'Yes, Tuesday works.' : 'No, keep my existing appointment.';
  const version = r.customerInputVersion + 1;
  f.db.patch('communicationConversations', r.conversationId, { customerInputVersion: version });
  f.db.patch('whatsappMessages', id, { messageId: id, conversationId: r.conversationId, communicationAccountId: ACCOUNT,
    provider: 'wacli', direction: 'inbound', phone: r.phone, text, customerInputVersion: version,
    firstIngestedAtIso: f.clock().toISOString(), whatsappTimestamp: f.clock().toISOString() });
  f.db.patch('customerAgentInboundQueue', 'Q-AUTOMATION-REPLY', { conversationId: r.conversationId, communicationAccountId: ACCOUNT,
    messageId: id, expectedOwnershipVersion: r.ownershipVersion, expectedCustomerInputVersion: version });
  const service = createMayaRecoveryOfferService({ db: f.db, clock: f.clock, apiKeyProvider: () => 'offline-test-only',
    analyzeResponse: async ({ customerText }) => ({ decision, quote: customerText, confidence: 0.99, ambiguous: false }) });
  return service.respond({ offerId: offer.id, offerVersion: offer.version, decision, sourceQuote: text },
    { conversationId: r.conversationId, inboundMessageId: id });
}

test('actual cancellation handler -> coordinator/history/scheduling -> queue/poll/HTTP ACK -> accepted move stops further offers', async t => {
  const f = await install(t, { second: true });
  const originals = Object.fromEntries(['APT-1', 'APT-2'].map(id => [id, structuredClone(f.db.read('appointments', id))]));
  await start(f); const beforeResponse = await deliver(f);
  const selectedId = beforeResponse.recovery.appointmentId;
  const otherId = selectedId === 'APT-1' ? 'APT-2' : 'APT-1';
  // Equal-time requests use the configured stable case-ID tie-break, not fixture order.
  assert.deepEqual(f.db.read('appointments', selectedId), originals[selectedId]);
  const result = await respond(f, 'accept');
  assert.equal(result.appointment.id, selectedId); assert.equal(result.appointment.date, '2026-09-08');
  const after = f.offer();
  const event = { data: { before: snapshot(after.id, beforeResponse), after: snapshot(after.id, after) } };
  assert.equal((await handleRecoveryOfferChange(event, f.coordinator)).scheduled, true);
  const completed = await f.coordinator.run(f.tasks.at(-1).payload);
  assert.equal(completed.status, 'completed', JSON.stringify(completed));
  assert.equal(f.state().history[0].outcome, 'accepted');
  assert.equal(f.outgoing().length, 1); assert.deepEqual(f.db.read('appointments', otherId), originals[otherId]);
  for (const id of originals[selectedId].capacityLockIds) assert.equal(f.db.read('bookingCapacityLocks', id).active, false);
  for (const id of originals[otherId].capacityLockIds) assert.equal(f.db.read('bookingCapacityLocks', id).active, true);
  assert.equal(f.db.read('bookingCapacityLocks', f.targetLocks[0].id).active, true);
  assert.equal((await f.coordinator.run(f.payload)).reason, 'already_terminal');
});
test('actual delivered decline -> offer-result event -> another compatible customer, with first booking and general interest intact', async t => {
  const f = await install(t, { second: true }); await start(f); const first = await deliver(f);
  const original = structuredClone(f.db.read('appointments', first.recovery.appointmentId));
  assert.equal((await respond(f, 'decline')).state, 'declined');
  const declined = f.offer();
  assert.equal((await handleRecoveryOfferChange({ data: { before: snapshot(first.id, first), after: snapshot(first.id, declined) } }, f.coordinator)).scheduled, true);
  const result = await f.coordinator.run(f.tasks.at(-1).payload);
  assert.equal(result.status, 'waiting_reply', JSON.stringify(result));
  assert.equal(f.offer().version, first.version + 1);
  assert.notEqual(f.offer().recovery.conversationId, first.recovery.conversationId);
  assert.equal(f.state().history[0].outcome, 'declined'); assert.equal(f.outgoing().length, 2);
  assert.deepEqual(f.db.read('appointments', first.recovery.appointmentId), original);
  assert.equal(f.db.read('communicationCases', first.recovery.caseId).state, 'WAITING');
});
test('duplicate cancellation events do not produce another offer and derived metadata does not recursively trigger discovery', async t => {
  const f = await install(t);
  const before = { ...f.db.read('appointments', 'CANCEL-1'), status: 'confirmed', cancelledAtIso: null };
  await start(f);
  assert.equal((await handleCancellationChange(cancellationEvent(f, before), f.coordinator)).scheduled, true);
  assert.equal((await f.coordinator.run(f.tasks.at(-1).payload)).status, 'waiting_reply');
  assert.equal(f.outgoing().length, 1);
  const current = f.db.read('appointments', 'CANCEL-1');
  const result = await handleCancellationChange(cancellationEvent(f, { ...current, mayaRecoveryAutomation: undefined }), f.coordinator);
  assert.equal(result.reason, 'not_new_cancellation');
});
test('event for an old cancellation generation is rejected after canonical scheduling data changed', async t => {
  const f = await install(t);
  const old = { ...f.db.read('appointments', 'CANCEL-1') };
  f.db.patch('appointments', 'CANCEL-1', { status: 'confirmed' });
  const event = { data: { before: snapshot('CANCEL-1', null), after: snapshot('CANCEL-1', old) } };
  assert.equal((await handleCancellationChange(event, f.coordinator)).reason, 'recovery_automation_generation_changed');
  assert.equal(f.tasks.length, 0); assert.equal(f.analyses.length, 0);
});
test('ordinary offers, duplicate results and pending dispatch holds do not trigger recovery tasks', async t => {
  const f = await install(t); const calls = [];
  const service = { scheduleCancellation: async args => { calls.push(args); return { scheduled: true }; } };
  const pending = { ...f.db.read('appointments', 'CANCEL-1'), status: 'confirmed', dispatchHold: { active: true } };
  assert.equal((await handleCancellationChange({ data: { after: snapshot('CANCEL-1', pending) } }, service)).scheduled, false);
  const ordinary = { version: 1, status: 'booked' };
  assert.equal((await handleRecoveryOfferChange({ data: { after: snapshot('OFFER', ordinary) } }, service)).scheduled, false);
  await start(f); const offer = f.offer();
  assert.equal((await handleRecoveryOfferChange({ data: { before: snapshot(offer.id, offer), after: snapshot(offer.id, offer) } }, service)).scheduled, false);
  assert.equal(calls.length, 0);
});
test('revoking automation after enqueue is checked by the actual Wacli claim before any delivery', async t => {
  const f = await install(t); await start(f); const offer = f.offer();
  f.db.patch('businessSettings', 'customer-agent', { recoveryAutomationEnabled: false });
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'synthetic-bridge', ACCOUNT, f.clock().getTime()), null);
  const queue = f.db.read('whatsappOutboundQueue', offer.recovery.outbound.queueId);
  assert.equal(queue.status, 'failed'); assert.equal(queue.recoveryAuthorizationReason, 'recovery_automation_disabled');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
});
test('single Thursday candidate moves to Tuesday and coordinator finalization retry never restarts outreach', async t => {
  const f = await install(t); await start(f); await deliver(f);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal((await respond(f, 'accept')).appointment.date, '2026-09-08');
  const transaction = f.db.runTransaction.bind(f.db); let fail = true;
  f.db.runTransaction = (callback, options) => transaction(raw => callback({
    get: raw.get.bind(raw), set(ref, value, writeOptions) {
      if (fail && ref.path === 'appointments/CANCEL-1' && value.mayaRecoveryAutomation?.status === 'completed') {
        fail = false; throw new Error('simulated finalization storage failure');
      }
      return raw.set(ref, value, writeOptions);
    },
  }), options);
  await assert.rejects(() => f.coordinator.run(f.payload), /finalization storage failure/);
  assert.equal(f.state().history[0].outcome, 'accepted');
  const completed = await f.coordinator.run(f.payload);
  assert.equal(completed.status, 'completed', JSON.stringify(completed));
  assert.equal(f.outgoing().length, 1); assert.equal(f.offer().version, 1);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
});
