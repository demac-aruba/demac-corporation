'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW, CONV } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryConversationTools, readRecoveryTurnScope } = require('./mayaRecoveryConversationTools');
const { createDemacCustomerToolRegistry, TOOL_ORDER } = require('./demacCustomerToolRegistry');
const { createCustomerAgentRuntime } = require('./demacCustomerAgentRuntimeV1');
const { DEFINITION } = require('./demacCustomerBookingInterest');
const CONTEXT = { conversationId: CONV, inboundMessageId: 'MSG-2' };
const DECLINE = { action: 'decline_offer', kind: '', customerId: '', propertyId: '', appointmentId: '', sourceQuote: '', dateFrom: '', dateTo: '' };
const clock = () => new Date(NOW.getTime() + 120000);
function acceptArgs(context) {
  return { appointmentId: context.appointmentId, offerId: context.offerId, offerVersion: context.offerVersion,
    optionId: context.optionId, reason: '', note: '' };
}
function call(name, args, n) {
  return { output: [{ type: 'function_call', name, call_id: `call-${n}`, arguments: JSON.stringify(args) }] };
}
async function setup(text = 'Yes, please move it to Tuesday.', analyzer) {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: true });
  const prepared = await f.prepare();
  await f.delivered(prepared);
  f.inbound(text);
  const analysis = [];
  const recoveryTools = createMayaRecoveryConversationTools({ db: f.db, clock,
    apiKeyProvider: () => 'synthetic-not-a-credential', analyzeResponse: async args => {
      analysis.push(args);
      return analyzer ? analyzer(args, f) : { decision: text === 'No, keep Thursday.' ? 'decline' : 'accept',
        quote: text, confidence: 0.99, ambiguous: false };
    } });
  const registry = createDemacCustomerToolRegistry({ db: f.db, recoveryTools });
  f.db.writes.length = 0;
  return { ...f, prepared, registry, recoveryTools, analysis };
}
async function contextOf(f) {
  const result = await f.registry.invoke('get_appointment_change_context', {}, CONTEXT);
  assert.equal(result.success, true, JSON.stringify(result));
  return result;
}
function unchangedSchedule(f, before) {
  assert.equal(JSON.stringify([...f.db.docs].filter(([key]) => /^(appointments|workOrders|bookingCapacityLocks)\//.test(key))), before);
}
function scheduleState(f) { return JSON.stringify([...f.db.docs].filter(([key]) => /^(appointments|workOrders|bookingCapacityLocks)\//.test(key))); }
function runtime(f, sequence) {
  let step = 0;
  return createCustomerAgentRuntime({ db: f.db, registry: f.registry,
    stateLoader: async () => ({ session: { status: 'AI_ACTIVE' } }), stateUpdater: async () => {}, outcomeRecorder: async () => {},
    modelClient: async () => {
      assert.ok(step < sequence.length, 'The single existing runtime must finish within the scripted turns');
      const [name, args] = sequence[step++];
      return call(name, args, step);
    } });
}
function body(f) {
  return { provider: 'wacli', channel: 'whatsapp', conversationId: CONV, inboundMessageId: 'MSG-2',
    conversation: { id: CONV, customerTurn: { id: 'MSG-2', text: f.db.read('whatsappMessages', 'MSG-2').text } } };
}
function finalResponse(outcome = 'appointment_rescheduled') {
  return { message: outcome === 'appointment_rescheduled' ? 'Your appointment has been moved to Tuesday.' : 'We will keep your current appointment.',
    outcome, language: 'en', requiresHuman: false, appointmentId: outcome === 'appointment_rescheduled' ? 'APT-1' : '', handoffQueue: '', handoffReason: '' };
}

test('registry keeps eighteen existing tool names and adds decline only to a cloned definition', async () => {
  const f = await setup();
  assert.equal(TOOL_ORDER.length, 18);
  assert.equal(f.registry.definitions.length, 18);
  assert.equal(new Set(f.registry.definitions.map(item => item.name)).size, 18);
  assert.equal(DEFINITION.parameters.properties.action.enum.includes('decline_offer'), false);
  assert.equal(f.registry.definitions.find(item => item.name === 'record_booking_interest').parameters.properties.action.enum.includes('decline_offer'), true);
});

test('current offer context is a read-only view of the exact existing appointment and offered choice', async () => {
  const f = await setup(); const before = JSON.stringify([...f.db.docs]);
  const context = await contextOf(f);
  assert.equal(context.workflow, 'earlier_offer'); assert.equal(context.deliveryBound, true);
  assert.equal(context.date, '2026-09-08'); assert.equal(context.appointment.date, '2026-09-10');
  assert.equal(context.capacityReserved, false);
  assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.db.writes.length, 0);
});

test('actual single Runtime -> registry -> recovery service advances Thursday to Tuesday and emits verified reschedule outcome', async () => {
  const f = await setup(); const context = await contextOf(f);
  const agent = runtime(f, [['get_appointment_change_context', {}], ['reschedule_appointment', acceptArgs(context)],
    ['respond_to_customer', finalResponse()]]);
  const result = await agent.runTurn({ rawBody: body(f), apiKey: 'synthetic-not-a-credential' });
  assert.equal(result.metadata.outcome, 'appointment_rescheduled'); assert.equal(result.metadata.appointmentId, 'APT-1');
  assert.equal(result.metadata.appointmentRescheduled, true);
  assert.equal(result.metadata.toolCalls.find(item => item.name === 'reschedule_appointment').appointmentLifecycleOutcome, 'appointment_rescheduled');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'FULFILLED');
  assert.equal(f.analysis.length, 1);
  assert.ok(f.originalLocks.every(lock => f.db.read('bookingCapacityLocks', lock.id).active === false));
  assert.ok(f.targetLocks.every(lock => f.db.read('bookingCapacityLocks', lock.id).appointmentId === 'APT-1'));
});

test('actual Runtime decline keeps both Thursday and the general waiting preference', async () => {
  const f = await setup('No, keep Thursday.'); const before = scheduleState(f);
  const agent = runtime(f, [['get_appointment_change_context', {}], ['record_booking_interest', DECLINE],
    ['respond_to_customer', finalResponse('reply')]]);
  const result = await agent.runTurn({ rawBody: body(f), apiKey: 'synthetic-not-a-credential' });
  assert.equal(result.metadata.outcome, 'reply'); unchangedSchedule(f, before);
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'WAITING');
  assert.equal(f.db.read('bookingOffers', f.prepared.offerId).recovery.state, 'declined');
});

for (const name of TOOL_ORDER.filter(name => !['get_appointment_change_context', 'reschedule_appointment', 'record_booking_interest'].includes(name))) {
  test(`scoped response cannot fall through to ${name}`, async () => {
    const f = await setup(); const before = JSON.stringify([...f.db.docs]);
    const result = await f.registry.invoke(name, {}, CONTEXT);
    assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_chat_use_scoped_offer');
    assert.equal(JSON.stringify([...f.db.docs]), before);
  });
}

test('withdraw-all and recovery-history writes are not confused with declining one offered time', async () => {
  const f = await setup('No, keep Thursday.'); const before = JSON.stringify([...f.db.docs]);
  for (const action of ['withdraw', 'register', 'recover_recent']) {
    const result = await f.registry.invoke('record_booking_interest', { ...DECLINE, action }, CONTEXT);
    assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_chat_use_scoped_offer');
  }
  assert.equal(JSON.stringify([...f.db.docs]), before);
});

for (const [field, value] of [['appointmentId', 'FOREIGN'], ['offerId', 'FOREIGN'], ['offerVersion', 99], ['optionId', 'FOREIGN']]) {
  test(`caller cannot change recovery ${field}`, async () => {
    const f = await setup(); const context = await contextOf(f); const before = scheduleState(f);
    const result = await f.registry.invoke('reschedule_appointment', { ...acceptArgs(context), [field]: value }, CONTEXT);
    assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_chat_option_mismatch');
    unchangedSchedule(f, before); assert.equal(f.analysis.length, 0);
  });
}

test('invented tool prose cannot change a real decline into accepted consent', async () => {
  const f = await setup('No, keep Thursday.'); const context = await contextOf(f); const before = scheduleState(f);
  const result = await f.registry.invoke('reschedule_appointment', { ...acceptArgs(context), note: 'Yes, move it.', reason: 'Accepted' }, CONTEXT);
  assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_response_requires_clarification');
  assert.equal(f.analysis[0].customerText, 'No, keep Thursday.'); unchangedSchedule(f, before);
});

test('routing permission is rechecked after interpretation before any canonical write', async () => {
  const f = await setup(undefined, async (args, fixture) => {
    fixture.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: false });
    return { decision: 'accept', quote: args.customerText, confidence: 0.99, ambiguous: false };
  });
  const context = await contextOf(f); const before = scheduleState(f);
  const result = await f.registry.invoke('reschedule_appointment', acceptArgs(context), CONTEXT);
  assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_chat_routing_disabled');
  unchangedSchedule(f, before);
});

for (const patch of [{ recoveryResponseRoutingEnabled: false }, { autoReplyAllowlist: [] }, { enabled: false }, { autoRescheduleEnabled: false }]) {
  test(`revoked authorization does not route to an ordinary mutation: ${JSON.stringify(patch)}`, async () => {
    const f = await setup(); const context = await contextOf(f); const before = scheduleState(f);
    f.db.patch('businessSettings', 'customer-agent', patch);
    const result = await f.registry.invoke('reschedule_appointment', acceptArgs(context), CONTEXT);
    assert.equal(result.success, false); unchangedSchedule(f, before);
  });
}

test('unbound delivery and multi-message responses remain blocked rather than guessed into consent', async () => {
  for (const changed of ['delivery', 'multiple']) {
    const f = await setup(); const context = await contextOf(f); const before = scheduleState(f);
    if (changed === 'delivery') {
      const offer = f.db.read('bookingOffers', f.prepared.offerId);
      f.db.patch('bookingOffers', offer.id, { recovery: { ...offer.recovery, state: 'prepared', delivery: null } });
    } else {
      f.db.patch('communicationConversations', CONV, { customerInputVersion: 6 });
      f.db.patch('whatsappMessages', 'MSG-2', { customerInputVersion: 6 });
      f.db.patch('customerAgentInboundQueue', 'Q-2', { expectedCustomerInputVersion: 6 });
    }
    const result = await f.registry.invoke('reschedule_appointment', acceptArgs(context), CONTEXT);
    assert.equal(result.success, false); unchangedSchedule(f, before);
  }
});

test('replayed accepted response does not repeat interpretation or scheduling', async () => {
  const f = await setup(); const context = await contextOf(f); const args = acceptArgs(context);
  assert.equal((await f.registry.invoke('reschedule_appointment', args, CONTEXT)).success, true);
  const before = JSON.stringify([...f.db.docs]);
  const replay = await f.registry.invoke('reschedule_appointment', args, CONTEXT);
  assert.equal(replay.success, true, JSON.stringify(replay)); assert.equal(replay.replayed, true);
  assert.equal(f.analysis.length, 1); assert.equal(JSON.stringify([...f.db.docs]), before);
});

test('later unrelated turns resume ordinary dispatch after a completed response', async () => {
  const f = await setup('No, keep Thursday.');
  assert.equal((await f.registry.invoke('record_booking_interest', DECLINE, CONTEXT)).success, true);
  f.db.patch('communicationConversations', CONV, { customerInputVersion: 6 });
  f.db.patch('whatsappMessages', 'MSG-3', { ...f.db.read('whatsappMessages', 'MSG-2'), id: 'MSG-3', customerInputVersion: 6, text: 'What is your warranty?' });
  assert.equal(await readRecoveryTurnScope({ db: f.db, context: { conversationId: CONV, inboundMessageId: 'MSG-3' } }), null);
});

test('scoped source or account errors never expose raw storage diagnostics or fall back', async () => {
  const f = await setup(); const before = scheduleState(f);
  const transaction = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = () => { throw new Error('private provider detail must not escape'); };
  const result = await f.registry.invoke('get_appointment_change_context', {}, CONTEXT);
  assert.equal(result.success, false); assert.equal(result.error.code, 'recovery_chat_unavailable');
  assert.equal(JSON.stringify(result).includes('private provider detail'), false);
  f.db.runTransaction = transaction; unchangedSchedule(f, before);
});

module.exports = { setup, contextOf, acceptArgs, CONTEXT, DECLINE, scheduleState };
