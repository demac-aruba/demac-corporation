'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { analyzeRecoveryResponse } = require('./mayaRecoveryResponseAnalysis');
async function setup() {
  const f = await fixture(); const offer = await f.prepare(); await f.delivered(offer); f.inbound();
  f.db.writes.length = 0; return { ...f, offer };
}
function otherOutbound(f, time, cachedTime = time) {
  f.db.patch('whatsappMessages', 'OTHER-OUT', { provider: 'wacli', direction: 'outbound', communicationAccountId: ACCOUNT,
    conversationId: CONV, text: 'Is the gate open?', firstIngestedAtIso: time, whatsappTimestamp: time });
  // A delayed offer ACK can append the offer last even though another question
  // was actually sent afterwards. Cache order and cached time are not authority.
  f.db.patch('communicationConversations', CONV, { recentMessages: [
    { id: 'OTHER-OUT', role: 'operator', text: 'Is the gate open?', at: cachedTime },
    { id: 'OUT-1', role: 'ai', text: f.offer.messageText, at: new Date(NOW.getTime() + 100000).toISOString() },
  ] });
}
const saved = f => JSON.stringify([...f.db.docs]);
test('review: ACK-reordered cache cannot attach an affirmation to the offer instead of a later original question', async () => {
  const f = await setup(); otherOutbound(f, new Date(NOW.getTime() + 90000).toISOString());
  const before = saved(f); await assert.rejects(() => f.respond(f.offer), { code: 'recovery_response_ambiguous' });
  assert.equal(saved(f), before); assert.equal(f.analysisCalls.length, 0);
});
test('review: old cached timestamp cannot hide a newer original outbound question', async () => {
  const f = await setup(); otherOutbound(f, new Date(NOW.getTime() + 90000).toISOString(), new Date(NOW.getTime() - 60000).toISOString());
  const before = saved(f); await assert.rejects(() => f.respond(f.offer), { code: 'recovery_response_ambiguous' });
  assert.equal(saved(f), before); assert.equal(f.analysisCalls.length, 0);
});
test('review: an old verified outbound message preceding preparation does not block a valid current acceptance', async () => {
  const f = await setup(); otherOutbound(f, new Date(NOW.getTime() - 60000).toISOString());
  assert.equal((await f.respond(f.offer)).state, 'accepted');
});
test('review: missing original outbound evidence requires clarification rather than trusting a cache', async () => {
  const f = await setup(); otherOutbound(f, new Date(NOW.getTime() - 60000).toISOString());
  f.db.docs.delete('whatsappMessages/OTHER-OUT'); const before = saved(f);
  await assert.rejects(() => f.respond(f.offer), { code: 'recovery_response_ambiguous' }); assert.equal(saved(f), before);
});
test('review: unchanged production analysis adapter receives complete chronological text through its existing request contract', async () => {
  const f = await setup();
  f.db.patch('whatsappMessages', 'MSG-2', { text: 'Yes' });
  const time = new Date(NOW.getTime() + 130000);
  f.db.patch('whatsappMessages', 'MSG-3', { ...f.db.read('whatsappMessages', 'MSG-2'), text: 'Actually no, leave Thursday.',
    customerInputVersion: 6, firstIngestedAtIso: time.toISOString(), whatsappTimestamp: time.toISOString() });
  f.db.patch('communicationConversations', CONV, { customerInputVersion: 6 });
  f.db.patch('customerAgentInboundQueue', 'Q-3', { conversationId: CONV, communicationAccountId: ACCOUNT, messageId: 'MSG-3',
    expectedOwnershipVersion: 2, expectedCustomerInputVersion: 6 });
  f.setTime(time);
  let transportCalls = 0;
  f.setAnalyzer(input => analyzeRecoveryResponse({ ...input, apiKey: 'synthetic-offline-key',
    fetchImpl: async (_url, options) => {
      transportCalls += 1;
      const body = JSON.parse(options.body); const inputBody = JSON.parse(body.input[0].content);
      assert.equal(inputBody.customerResponse, 'Yes\n\nActually no, leave Thursday.');
      assert.equal(inputBody.offer, f.offer.messageText); assert.equal(body.store, false);
      assert.equal(body.tool_choice.name, 'classify_recovery_response');
      return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'function_call',
        name: 'classify_recovery_response', arguments: JSON.stringify({ decision: 'decline',
          quote: 'Actually no, leave Thursday.', confidence: 0.99, ambiguous: false }) }] }) };
    } }));
  const result = await f.service.respond({ offerId: f.offer.offerId, offerVersion: 1, decision: 'decline',
    sourceQuote: 'Actually no, leave Thursday.' }, { conversationId: CONV, inboundMessageId: 'MSG-3' });
  assert.equal(result.state, 'declined'); assert.equal(transportCalls, 1);
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(f.db.read('communicationCases', f.caseId).state, 'WAITING');
});
