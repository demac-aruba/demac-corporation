'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-confirmation-tests', storageBucket: 'demo-maya-confirmation-tests.appspot.com' });
const { getFirestore } = require('firebase-admin/firestore');
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryConfirmation, confirmationQueueId, ordinaryReplyId } = require('./mayaRecoveryConfirmation');
const communication = require('./demacCustomerAgentCommunication');
const gateway = require('./whatsappWacliGateway');
const AT = NOW.getTime() + 180000;
const TOKEN = 'offline-confirmation-bridge';
const context = () => ({ conversationId: CONV, inboundMessageId: 'MSG-2', communicationAccountId: ACCOUNT,
  expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 });
function setEnvironment(t, name, value) {
  const old = process.env[name]; process.env[name] = value;
  t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
}
async function setup(t, accept = true) {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: true, recoveryConfirmationEnabled: true });
  const offer = await f.prepare(); await f.delivered(offer); f.inbound();
  if (accept) await f.respond(offer);
  t.mock.timers.enable({ apis: ['Date'], now: AT });
  const firestore = getFirestore();
  t.mock.method(firestore, 'collection', name => f.db.collection(name));
  t.mock.method(firestore, 'runTransaction', (...args) => f.db.runTransaction(...args));
  // Support the real communication/session service's nontransactional writes
  // without weakening MemoryDb's transaction read-before-write assertion.
  const refPrototype = Object.getPrototypeOf(f.db.collection('synthetic').doc('ref'));
  const oldSet = Object.getOwnPropertyDescriptor(refPrototype, 'set');
  Object.defineProperty(refPrototype, 'set', { configurable: true, value: function(value, options) {
    return this.db.runTransaction(transaction => transaction.set(this, value, options));
  } });
  t.after(() => { if (oldSet) Object.defineProperty(refPrototype, 'set', oldSet); else delete refPrototype.set; });
  setEnvironment(t, 'WACLI_BRIDGE_TOKEN', TOKEN);
  setEnvironment(t, 'OPENAI_API_KEY', 'offline-confirmation-model');
  f.db.patch('customerAgentInboundQueue', 'Q-2', { status: 'queued', provider: 'wacli', customerInputVersion: 5, attempts: 1 });
  const confirmation = createMayaRecoveryConfirmation({ db: f.db });
  return { ...f, offer, confirmation };
}
async function acknowledge(command, overrides = {}) {
  const headers = { authorization: `Bearer ${TOKEN}`, 'x-demac-communication-account-id': ACCOUNT };
  const req = { method: 'POST', body: { queueId: command.queueId, claimToken: command.claimToken,
    sent: true, messageId: 'synthetic-confirmation-provider-message', ...overrides },
    get(name) { return headers[name.toLowerCase()]; } };
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; },
    set() { return this; }, on() { return this; } };
  await gateway.wacliOutboundAck(req, res); return res;
}

test('real current-turn processor recovers committed result, publishes one confirmation and records its actual ACK shape', async t => {
  const f = await setup(t); let modelCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { modelCalls++; throw new Error('No live request is permitted'); });
  const before = JSON.stringify([...f.db.docs].filter(([path]) => /^(appointments|workOrders|bookingCapacityLocks)\//.test(path)));
  const result = await communication.processLatestQueued(CONV, 'offline-lease');
  assert.equal(result.processed, true); assert.equal(result.outcome, 'appointment_rescheduled'); assert.equal(modelCalls, 0);
  const id = confirmationQueueId(CONV, 'MSG-2');
  assert.equal(f.db.read('customerAgentInboundQueue', 'Q-2').status, 'processed');
  assert.equal(f.db.read('whatsappOutboundQueue', ordinaryReplyId(CONV, 'MSG-2')), undefined);
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, AT);
  assert.equal(command.queueId, id); assert.match(command.text, /2026-09-08.*09:30/);
  const ack = await acknowledge(command); assert.equal(ack.statusCode, 200, JSON.stringify(ack.body)); assert.equal(ack.body.sent, true);
  const queue = f.db.read('whatsappOutboundQueue', id); const message = f.db.read('whatsappMessages', queue.messageId);
  assert.equal(queue.status, 'sent'); assert.equal(message.queueId, id); assert.equal(message.text, command.text);
  assert.equal(message.recoveryConfirmationAcknowledgedAtIso, queue.recoveryConfirmationAcknowledgedAtIso);
  assert.equal(message.whatsappTimestamp, undefined, 'ACK is not a made-up provider timestamp');
  const snapshot = JSON.stringify([...f.db.docs]);
  assert.equal((await acknowledge(command)).body.alreadyAcknowledged, true);
  assert.equal(JSON.stringify([...f.db.docs]), snapshot);
  assert.equal((await communication.queueAgentReply({ ...context(), provider: 'wacli', result: { draft: 'Wrong time' } })).existing, true);
  assert.equal(JSON.stringify([...f.db.docs].filter(([path]) => /^(appointments|workOrders|bookingCapacityLocks)\//.test(path))), before);
});
test('actual Runtime commits an accepted move, its final model call fails, and the existing turn processor still queues verified confirmation', async t => {
  const f = await setup(t, false); let modelStep = 0; let semanticCalls = 0;
  const stored = f.db.read('bookingOffers', f.offer.offerId);
  const call = (name, args) => ({ ok: true, json: async () => ({ status: 'completed', output: [
    { type: 'function_call', call_id: `offline-${name}-${modelStep}`, name, arguments: JSON.stringify(args) } ] }) });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.tool_choice?.name === 'classify_recovery_response') {
      semanticCalls++; return call('classify_recovery_response', { decision: 'accept', quote: 'Yes, please move it to Tuesday.', confidence: 0.99, ambiguous: false });
    }
    modelStep++;
    if (modelStep === 1) return call('get_appointment_change_context', {});
    if (modelStep === 2) return call('reschedule_appointment', { appointmentId: 'APT-1', offerId: f.offer.offerId,
      offerVersion: f.offer.offerVersion, optionId: stored.options[0].id, reason: '', note: '' });
    throw new Error('Offline final model response failure');
  });
  const result = await communication.processLatestQueued(CONV, 'offline-failing-model-lease');
  assert.equal(result.processed, true); assert.equal(result.outcome, 'appointment_rescheduled');
  assert.equal(semanticCalls, 1); assert.ok(modelStep >= 3);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  assert.match(f.db.read('whatsappOutboundQueue', confirmationQueueId(CONV, 'MSG-2')).text, /2026-09-08.*09:30/);
  assert.equal(f.db.read('customerAgentInboundQueue', 'Q-2').status, 'processed');
});
test('actual transport claim blocks a changed canonical appointment after confirmation was queued', async t => {
  const f = await setup(t); await f.confirmation.enqueueIfCompleted({ context: context() });
  f.db.patch('appointments', 'APT-1', { date: '2026-09-09' });
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, AT), null);
  assert.equal(f.db.read('whatsappOutboundQueue', confirmationQueueId(CONV, 'MSG-2')).status, 'failed');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-09');
});
test('an uncertain previous confirmation attempt is never automatically reclaimed after its lease expires', async t => {
  const f = await setup(t); await f.confirmation.enqueueIfCompleted({ context: context() });
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, AT);
  assert.ok(command);
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, AT + 240000), null);
  assert.equal(f.db.read('whatsappOutboundQueue', command.queueId).status, 'failed');
  await assert.rejects(f.confirmation.enqueueIfCompleted({ context: context() }), { code: 'recovery_confirmation_reconciliation_required' });
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
});
test('confirmation ACK after operator takeover preserves unread count and operator state', async t => {
  const f = await setup(t); await f.confirmation.enqueueIfCompleted({ context: context() });
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, AT);
  f.db.patch('communicationConversations', CONV, { aiDisposition: 'human_active', ownerUserId: 'offline-operator', status: 'assigned', unread: 4 });
  const ack = await acknowledge(command); assert.equal(ack.statusCode, 200, JSON.stringify(ack.body));
  const conversation = f.db.read('communicationConversations', CONV);
  assert.equal(conversation.ownerUserId, 'offline-operator'); assert.equal(conversation.aiDisposition, 'human_active');
  assert.equal(conversation.status, 'assigned'); assert.equal(conversation.unread, 4);
});
test('missing or conflicting provider IDs and altered claimed confirmation text are rejected by the actual ACK', async t => {
  const f = await setup(t); await f.confirmation.enqueueIfCompleted({ context: context() });
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, AT);
  assert.equal((await acknowledge(command, { messageId: '' })).statusCode, 400);
  assert.equal((await acknowledge(command, { messageId: command.queueId })).statusCode, 400);
  const q = f.db.read('whatsappOutboundQueue', command.queueId);
  f.db.patch('whatsappOutboundQueue', command.queueId, { text: 'Not the claimed confirmation' });
  assert.equal((await acknowledge(command)).statusCode, 409);
  f.db.docs.set(`whatsappOutboundQueue/${command.queueId}`, q);
  assert.equal((await acknowledge(command)).statusCode, 200);
  assert.equal((await acknowledge(command, { messageId: 'different-offline-provider-id' })).statusCode, 409);
});
test('removing confirmation metadata and relabeling its class cannot bypass the reserved queue identity', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  const changed = { ...f.db.read('whatsappOutboundQueue', queued.id), outboundClass: 'transactional' };
  delete changed.recoveryConfirmation;
  f.db.docs.set(`whatsappOutboundQueue/${queued.id}`, changed);
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'offline-bridge', ACCOUNT, AT), null);
  assert.equal(f.db.read('whatsappOutboundQueue', queued.id).status, 'failed');
});
