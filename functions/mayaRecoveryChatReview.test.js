'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { fixture, NOW, CONV, PHONE } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryConversationTools, readRecoveryTurnScope } = require('./mayaRecoveryConversationTools');
const { createDemacCustomerToolRegistry } = require('./demacCustomerToolRegistry');
const { createCustomerAgentRuntime } = require('./demacCustomerAgentRuntimeV1');
const CONTEXT = { conversationId: CONV, inboundMessageId: 'MSG-2' };
const clock = () => new Date(NOW.getTime() + 120000);
function argsFor(context) { return { appointmentId: context.appointmentId, offerId: context.offerId,
  offerVersion: context.offerVersion, optionId: context.optionId, reason: '', note: '' }; }
async function ready() {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: true, observationEnabled: true });
  const prepared = await f.prepare(); await f.delivered(prepared); f.inbound();
  const recoveryTools = createMayaRecoveryConversationTools({ db: f.db, clock,
    apiKeyProvider: () => 'synthetic-not-a-credential',
    analyzeResponse: async ({ customerText }) => ({ decision: 'accept', quote: customerText, confidence: 0.99, ambiguous: false }) });
  const registry = createDemacCustomerToolRegistry({ db: f.db, recoveryTools });
  f.db.writes.length = 0;
  return { ...f, prepared, recoveryTools, registry };
}
function loadObserver(f) {
  const file = path.join(__dirname, 'demacCustomerObserverCommunication.js');
  const native = createRequire(file); const exported = { exports: {} };
  const calls = { model: 0, cases: 0 };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: exported, exports: exported.exports,
    require(name) {
      if (name === 'firebase-admin/app') return { getApps: () => [{}], getApp: () => ({}) };
      if (name === 'firebase-admin/firestore') return { ...native(name), getFirestore: () => f.db };
      if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'synthetic-not-a-credential' }) };
      if (name === './demacCustomerObserver') return { MAYA_OBSERVER_VERSION: 1, createMayaCustomerObserver: () => ({
        observe: async () => { calls.model++; return { intent: 'general', confidence: 0.99, language: 'en', summary: 'Synthetic general message', requiresAttention: false, dispatchRisk: false }; },
      }) };
      if (name === './demacCommunicationCaseService') return { createCommunicationCaseService: () => ({
        processObservation: async () => { calls.cases++; return { processed: false }; },
      }) };
      return native(name);
    }, Date, console, Buffer, setTimeout, clearTimeout }, { filename: file });
  return { ...exported.exports, calls };
}
function observe(observer, f, overrides = {}) {
  return observer.processObservedMessage({ messageId: 'MSG-2', message: f.db.read('whatsappMessages', 'MSG-2'),
    expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5, ...overrides });
}

test('actual Observer service routes a current offered-time response without new model interpretation, Case or dispatch hold', async () => {
  const f = await ready(); const observer = loadObserver(f);
  const original = JSON.stringify(f.db.read('appointments', 'APT-1'));
  const result = await observe(observer, f);
  assert.equal(result.recoveryResponseRouted, true, JSON.stringify(result));
  assert.equal(result.reason, 'recovery-offer-response-routed');
  assert.equal(observer.calls.model, 0); assert.equal(observer.calls.cases, 0);
  assert.equal(JSON.stringify(f.db.read('appointments', 'APT-1')), original);
  const marker = f.db.read('whatsappMessages', 'MSG-2').mayaRecoveryResponseRoute;
  assert.equal(marker.offerId, f.prepared.offerId); assert.equal(marker.customerInputVersion, 5);
  const before = JSON.stringify([...f.db.docs]);
  await observe(observer, f); assert.equal(JSON.stringify([...f.db.docs]), before, 'Repeated route detection is idempotent');
});

test('recorded response route prevents pointer removal from reopening ordinary scheduling tools', async () => {
  const f = await ready(); await observe(loadObserver(f), f);
  f.db.patch('communicationConversations', CONV, { mayaRecoveryOffer: null });
  const before = JSON.stringify([...f.db.docs]);
  for (const tool of ['create_appointment', 'cancel_appointment', 'reschedule_appointment', 'get_appointment_change_context']) {
    const result = await f.registry.invoke(tool, {}, CONTEXT);
    assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_chat_scope_changed');
  }
  assert.equal(JSON.stringify([...f.db.docs]), before);
});

test('source route cannot be rebound to another offer version after the Observer', async () => {
  const f = await ready(); await observe(loadObserver(f), f);
  f.db.patch('communicationConversations', CONV, { mayaRecoveryOffer: { id: f.prepared.offerId, version: 999 } });
  const result = await f.registry.invoke('get_appointment_change_context', {}, CONTEXT);
  assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_offer_version_changed');
});

test('a failed route lookup raises office attention rather than entering the ordinary Case/hold path', async () => {
  const f = await ready(); const observer = loadObserver(f);
  f.db.patch('communicationConversations', CONV, { mayaRecoveryOffer: { id: 'missing', version: 1 } });
  const result = await observe(observer, f);
  assert.equal(result.reason, 'recovery-offer-context-requires-review');
  assert.equal(observer.calls.model, 0); assert.equal(observer.calls.cases, 0);
  assert.equal(f.db.read('communicationConversations', CONV).mayaAttentionRequired, true);
  assert.equal(f.db.read('appointments', 'APT-1').dispatchHold?.active, undefined);
});

test('ordinary messages without an offer retain the original Observer and Case path', async () => {
  const f = await ready(); f.db.patch('communicationConversations', CONV, { mayaRecoveryOffer: null });
  const observer = loadObserver(f); const result = await observe(observer, f);
  assert.equal(result.observed, true); assert.equal(observer.calls.model, 1); assert.equal(observer.calls.cases, 1);
});

test('observer stale epoch rejection still happens before routing or any write', async () => {
  const f = await ready(); const observer = loadObserver(f); const before = JSON.stringify([...f.db.docs]);
  const result = await observe(observer, f, { expectedOwnershipVersion: 1 });
  assert.equal(result.reason, 'stale-communication-epoch');
  assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(observer.calls.model, 0);
});

for (const changed of ['crm', 'property', 'capacity', 'work']) {
  test(`completed acceptance cannot disclose or replay obsolete ${changed} proof`, async () => {
    const f = await ready();
    const context = await f.registry.invoke('get_appointment_change_context', {}, CONTEXT);
    assert.equal((await f.registry.invoke('reschedule_appointment', argsFor(context), CONTEXT)).success, true);
    if (changed === 'crm') {
      f.db.patch('clients', 'C-1', { phone: '2975611111', whatsapp: '2975611111' });
      f.db.patch('clients', 'OTHER', { name: 'Another synthetic customer', phone: PHONE, whatsapp: PHONE, active: true });
    }
    if (changed === 'property') f.db.patch('properties', 'P-1', { clientId: 'OTHER' });
    if (changed === 'capacity') f.db.patch('bookingCapacityLocks', f.targetLocks[0].id, { active: true, appointmentId: 'OTHER' });
    if (changed === 'work') f.db.patch('workOrders', f.db.read('appointments', 'APT-1').workOrderIds[0], { clientId: 'OTHER' });
    const read = await f.registry.invoke('get_appointment_change_context', {}, CONTEXT);
    const replay = await f.registry.invoke('reschedule_appointment', argsFor(context), CONTEXT);
    assert.equal(read.success, false); assert.equal(replay.success, false);
    assert.equal('appointment' in read, false);
  });
}

test('malformed terminal response cannot escape routing into ordinary business mutations', async () => {
  const f = await ready(); const stored = f.db.read('bookingOffers', f.prepared.offerId);
  f.db.patch('bookingOffers', stored.id, { recovery: { ...stored.recovery, response: { messageId: 'different', decision: 'other' } } });
  const result = await f.registry.invoke('create_appointment', {}, CONTEXT);
  assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_chat_scope_changed');
});

test('readonly scope inspection does not write a routing receipt', async () => {
  const f = await ready(); const before = JSON.stringify([...f.db.docs]);
  assert.ok(await readRecoveryTurnScope({ db: f.db, context: CONTEXT }));
  assert.equal(JSON.stringify([...f.db.docs]), before);
  assert.equal(f.db.read('whatsappMessages', 'MSG-2').mayaRecoveryResponseRoute, undefined);
});

test('existing debounce orchestrator -> actual Observer gate -> actual Runtime registry -> canonical accepted move', async () => {
  const f = await ready(); const observer = loadObserver(f);
  f.db.patch('customerAgentInboundQueue', 'Q-2', { status: 'deferred', customerInputVersion: 5,
    eligibleAtIso: new Date(NOW.getTime() + 110000).toISOString() });
  const exact = await f.registry.invoke('get_appointment_change_context', {}, CONTEXT);
  let round = 0; let runtimeResult;
  const sequence = [['get_appointment_change_context', {}], ['reschedule_appointment', argsFor(exact)],
    ['respond_to_customer', { message: 'Your appointment is now on Tuesday.', outcome: 'appointment_rescheduled', language: 'en',
      requiresHuman: false, appointmentId: 'APT-1', handoffQueue: '', handoffReason: '' }]];
  const runtime = createCustomerAgentRuntime({ db: f.db, registry: f.registry,
    stateLoader: async () => ({ session: { status: 'AI_ACTIVE' } }), stateUpdater: async () => {}, outcomeRecorder: async () => {},
    modelClient: async () => {
      const [name, args] = sequence[round++];
      return { output: [{ type: 'function_call', name, call_id: `c-${round}`, arguments: JSON.stringify(args) }] };
    } });
  const communication = { AGENT_QUEUE_COLLECTION: 'customerAgentInboundQueue', shouldRunAgent: conversation => conversation.aiDisposition === 'ai_active',
    processQueueEvent: async ({ messageId, message }) => {
      runtimeResult = await runtime.runTurn({ apiKey: 'synthetic-not-a-credential', rawBody: { provider: 'wacli', channel: 'whatsapp',
        conversationId: CONV, inboundMessageId: messageId, conversation: { id: CONV, customerTurn: { id: messageId, text: message.text } } } });
      return { processed: true };
    } };
  const file = path.join(__dirname, 'demacCustomerTurnOrchestrator.js'); const native = createRequire(file); const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: exported, exports: exported.exports,
    require(name) {
      if (name === 'firebase-admin/app') return { getApps: () => [{}], getApp: () => ({}) };
      if (name === 'firebase-admin/firestore') return { ...native(name), getFirestore: () => f.db };
      if (name === 'firebase-functions/tasks') return { onTaskDispatched: (_options, handler) => handler };
      if (name === './demacCustomerAgentCommunication') return communication;
      if (name === './demacCustomerObserverCommunication') return observer;
      return native(name);
    }, Date, console, Buffer, setTimeout, clearTimeout }, { filename: file });
  const orchestrator = exported.exports.createCustomerTurnOrchestrator({ database: f.db, clock: () => clock().getTime(),
    observerProcessor: observer.processObservedMessage, agentCommunication: communication,
    taskQueue: { enqueue: async () => { throw new Error('An already eligible synthetic turn must not enqueue another task'); } } });
  const result = await orchestrator.wakeConversationTurn({ conversationId: CONV });
  assert.equal(result.processed, true, JSON.stringify(result));
  assert.equal(observer.calls.model, 0); assert.equal(observer.calls.cases, 0);
  assert.equal(runtimeResult.metadata.outcome, 'appointment_rescheduled');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'FULFILLED');
});
