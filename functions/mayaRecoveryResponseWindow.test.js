'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { loadRecoveryResponseWindow } = require('./mayaRecoveryResponseWindow');
const { createMayaRecoveryConversationTools } = require('./mayaRecoveryConversationTools');
const { createDemacCustomerToolRegistry } = require('./demacCustomerToolRegistry');
const { createCustomerAgentRuntime } = require('./demacCustomerAgentRuntimeV1');

function append(f, text, version = 6, id = 'MSG-3') {
  const time = new Date(NOW.getTime() + 120000 + (version - 5) * 1000);
  f.db.patch('whatsappMessages', id, { ...f.db.read('whatsappMessages', 'MSG-2'), text,
    customerInputVersion: version, firstIngestedAtIso: time.toISOString(), whatsappTimestamp: time.toISOString() });
  f.db.patch('communicationConversations', CONV, { customerInputVersion: version });
  f.db.patch('customerAgentInboundQueue', `Q-${version}`, { communicationAccountId: ACCOUNT, conversationId: CONV,
    messageId: id, expectedOwnershipVersion: 2, expectedCustomerInputVersion: version });
  f.setTime(time);
  return { conversationId: CONV, inboundMessageId: id };
}
async function setup(first = 'Yes', last = 'Tuesday works.') {
  const f = await fixture(); const offer = await f.prepare(); await f.delivered(offer);
  f.inbound(first); const context = append(f, last);
  f.setAnalyzer(async input => ({ decision: 'accept', quote: last, confidence: 0.99, ambiguous: false }));
  const respond = (decision = 'accept') => f.service.respond({ offerId: offer.offerId,
    offerVersion: offer.offerVersion, decision, sourceQuote: last.slice(0, 800) }, context);
  f.db.writes.length = 0;
  return { ...f, offer, context, respond, first, last };
}
const saved = f => JSON.stringify([...f.db.docs]);

test('consecutive Yes + Tuesday works is reviewed together and moves only after canonical acceptance', async () => {
  const f = await setup();
  const result = await f.respond();
  assert.equal(result.state, 'accepted');
  assert.equal(result.appointment.date, '2026-09-08');
  assert.equal(f.analysisCalls[0].customerText, 'Yes\n\nTuesday works.');
  assert.deepEqual(f.analysisCalls[0].customerMessages, ['Yes', 'Tuesday works.']);
  assert.deepEqual(f.db.read('bookingOffers', f.offer.offerId).recovery.response.responseWindow.messageIds, ['MSG-2', 'MSG-3']);
  assert.equal(f.db.read('bookingCapacityLocks', f.originalLocks[0].id).active, false);
  assert.equal(f.db.read('bookingCapacityLocks', f.targetLocks[0].id).active, true);
  assert.equal(f.db.read('workOrders', 'WO-APT-1-1').paid, 50);
});
test('a later refusal cannot be ignored in favor of the first affirmative; decline preserves Thursday and WAITING', async () => {
  const f = await setup('Yes', 'No, keep Thursday.');
  f.setAnalyzer(async ({ customerText }) => {
    assert.equal(customerText, 'Yes\n\nNo, keep Thursday.');
    return { decision: 'decline', quote: 'No, keep Thursday.', confidence: 0.99, ambiguous: false };
  });
  const before = saved(f);
  await assert.rejects(() => f.respond(), { code: 'recovery_response_requires_clarification' });
  assert.equal(saved(f), before);
  assert.equal((await f.respond('decline')).state, 'declined');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'WAITING');
});
test('a qualification in an earlier fragment is included even when the last fragment is affirmative', async () => {
  const f = await setup('Only if you can come at 08:00.', 'Yes, please.');
  f.setAnalyzer(async ({ customerText }) => {
    assert.ok(customerText.startsWith('Only if'));
    return { decision: 'needs_review', quote: 'Only if you can come at 08:00.', confidence: 0.99, ambiguous: true };
  });
  const before = saved(f); await assert.rejects(() => f.respond()); assert.equal(saved(f), before);
});
for (const [label, change] of [
  ['missing earlier source', f => f.db.docs.delete('whatsappMessages/MSG-2')],
  ['duplicate version', f => f.db.patch('whatsappMessages', 'DUP', { ...f.db.read('whatsappMessages', 'MSG-2') })],
  ['foreign account', f => f.db.patch('whatsappMessages', 'MSG-2', { communicationAccountId: 'another-account' })],
  ['foreign conversation', f => f.db.patch('whatsappMessages', 'MSG-2', { conversationId: 'another-chat' })],
  ['outbound pretending to be response', f => f.db.patch('whatsappMessages', 'MSG-2', { direction: 'outbound' })],
  ['unfinished voice', f => f.db.patch('whatsappMessages', 'MSG-2', { mediaType: 'audio', transcriptionStatus: 'pending', text: 'Yes' })],
  ['opaque image', f => f.db.patch('whatsappMessages', 'MSG-2', { mediaType: 'image', mediaCaption: 'Yes' })],
  ['reordered provider times', f => f.db.patch('whatsappMessages', 'MSG-3', { whatsappTimestamp: new Date(NOW.getTime() + 119000).toISOString() })],
  ['future receipt', f => f.db.patch('whatsappMessages', 'MSG-2', { firstIngestedAtIso: '2099-01-01T00:00:00Z' })],
  ['foreign routing receipt', f => f.db.patch('whatsappMessages', 'MSG-2', { mayaRecoveryResponseRoute: { version: 1, offerId: 'OTHER' } })],
  ['another outbound question', f => f.db.patch('communicationConversations', CONV, { recentMessages: [{ id: 'OUT-1', role: 'ai' }, { id: 'OTHER-OUT', role: 'ai', text: 'Another question' }] })],
]) {
  test(`${label} blocks the whole response before model interpretation or schedule writes`, async () => {
    const f = await setup(); change(f); const before = saved(f);
    await assert.rejects(() => f.respond());
    assert.equal(saved(f), before); assert.equal(f.analysisCalls.length, 0);
  });
}
test('complete transcript in an earlier fragment is part of consent evidence', async () => {
  const f = await setup();
  f.db.patch('whatsappMessages', 'MSG-2', { mediaType: 'audio', text: '[Audio]', transcriptionStatus: 'completed', rawTranscript: 'Yes', transcriptionVersion: 'test-v1' });
  assert.equal((await f.respond()).state, 'accepted');
  assert.equal(f.analysisCalls[0].customerText, 'Yes\n\nTuesday works.');
});
test('total response length is bounded without truncating a reversal in a later part', async () => {
  const f = await setup('a'.repeat(4000), 'b'.repeat(4000)); const before = saved(f);
  await assert.rejects(() => f.respond(), { code: 'recovery_response_requires_clarification' });
  assert.equal(saved(f), before); assert.equal(f.analysisCalls.length, 0);
});
test('more than six fragments is a review case, not an unbounded scan', async () => {
  const f = await setup(); const context = append(f, 'Please.', 11, 'MSG-LAST');
  const beforeQueries = f.db.queries.length;
  await assert.rejects(() => f.service.respond({ offerId: f.offer.offerId, offerVersion: 1,
    decision: 'accept', sourceQuote: 'Please.' }, context), { code: 'recovery_response_window_incomplete' });
  assert.equal(f.analysisCalls.length, 0);
  assert.ok(f.db.queries.length - beforeQueries < 10);
});
test('an edit to any earlier part while the model runs invalidates the final commit', async () => {
  const f = await setup();
  f.setAnalyzer(async () => {
    f.db.patch('whatsappMessages', 'MSG-2', { text: 'Yes. Actually no, keep Thursday.' });
    return { decision: 'accept', quote: 'Tuesday works.', confidence: 0.99, ambiguous: false };
  });
  await assert.rejects(() => f.respond(), { code: 'recovery_stale_response' });
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(f.db.read('bookingCapacityLocks', f.originalLocks[0].id).active, true);
  assert.equal(f.db.writes.length, 0);
});
test('exact completed replay is idempotent but editing the first part cannot replay the completion', async () => {
  const f = await setup(); await f.respond(); const before = saved(f);
  assert.equal((await f.respond()).replayed, true); assert.equal(saved(f), before); assert.equal(f.analysisCalls.length, 1);
  f.db.patch('whatsappMessages', 'MSG-2', { text: 'No, do not move it.' });
  await assert.rejects(() => f.respond(), { code: 'recovery_response_conflict' });
  assert.equal(f.analysisCalls.length, 1);
});
test('a failed final transaction preserves the offer, original appointment and both capacities', async () => {
  const f = await setup(); const before = saved(f);
  f.setAnalyzer(async () => { f.db.failCommit = true; return { decision: 'accept', quote: f.last, confidence: 0.99, ambiguous: false }; });
  await assert.rejects(() => f.respond(), /Simulated atomic commit failure/); assert.equal(saved(f), before);
});
test('scoped context is read only and shows how many canonical response fragments were checked', async () => {
  const f = await setup(); f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: true });
  const tools = createMayaRecoveryConversationTools({ db: f.db, clock: () => new Date(NOW.getTime() + 180000) });
  const before = saved(f); const result = await tools.invokeIfScoped('get_appointment_change_context', {}, f.context);
  assert.equal(result.success, true); assert.equal(result.responseEvidenceReady, true);
  assert.equal(result.responseMessageCount, 2); assert.equal(saved(f), before);
});
test('existing Runtime and registry accept the complete split reply through canonical lifecycle', async () => {
  const f = await setup(); f.db.patch('businessSettings', 'customer-agent', { recoveryResponseRoutingEnabled: true });
  const recoveryTools = createMayaRecoveryConversationTools({ db: f.db, clock: () => new Date(NOW.getTime() + 180000),
    apiKeyProvider: () => 'synthetic', analyzeResponse: async ({ customerText }) => {
      assert.equal(customerText, 'Yes\n\nTuesday works.');
      return { decision: 'accept', quote: 'Tuesday works.', confidence: 0.99, ambiguous: false };
    } });
  const registry = createDemacCustomerToolRegistry({ db: f.db, recoveryTools });
  const option = f.db.read('bookingOffers', f.offer.offerId).options[0];
  const calls = [
    ['get_appointment_change_context', {}],
    ['reschedule_appointment', { appointmentId: 'APT-1', offerId: f.offer.offerId, offerVersion: 1, optionId: option.id, reason: '', note: '' }],
    ['respond_to_customer', { message: 'Your appointment is now on Tuesday.', outcome: 'appointment_rescheduled', language: 'en', requiresHuman: false,
      appointmentId: 'APT-1', handoffQueue: '', handoffReason: '' }],
  ];
  let next = 0;
  const runtime = createCustomerAgentRuntime({ db: f.db, registry, stateLoader: async () => ({ session: { status: 'AI_ACTIVE' } }),
    stateUpdater: async () => {}, outcomeRecorder: async () => {}, modelClient: async () => {
      const [name, args] = calls[next++]; return { output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: `call-${next}` }] };
    } });
  const result = await runtime.runTurn({ apiKey: 'synthetic', rawBody: { provider: 'wacli', channel: 'whatsapp',
    conversation: { id: CONV, customerTurn: { id: 'MSG-3', text: f.last }, messages: [
      { id: 'OUT-1', direction: 'outbound', text: f.offer.messageText },
      { id: 'MSG-2', direction: 'inbound', text: f.first }, { id: 'MSG-3', direction: 'inbound', text: f.last },
    ] } } });
  assert.equal(result.metadata.outcome, 'appointment_rescheduled');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  assert.equal(next, 3);
});
