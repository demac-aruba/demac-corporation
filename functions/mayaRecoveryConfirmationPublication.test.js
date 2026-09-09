'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryConfirmation } = require('./mayaRecoveryConfirmation');
async function setup() {
  const f = await fixture(); const offer = await f.prepare(); await f.delivered(offer); f.inbound();
  return { ...f, offer };
}
for (const status of ['queued', 'processing', 'sent', 'delivered', 'failed']) {
  test(`a previously published ${status} response blocks a later new acceptance for the same source`, async () => {
    const f = await setup();
    f.db.patch('whatsappOutboundQueue', 'existing-source-reply', { communicationAccountId: ACCOUNT,
      conversationId: CONV, sourceInboundMessageId: 'MSG-2', status, text: 'The existing reply' });
    const before = JSON.stringify([...f.db.docs]);
    await assert.rejects(f.respond(f.offer), { code: 'recovery_response_already_published' });
    assert.equal(JSON.stringify([...f.db.docs]), before);
    assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-10');
  });
}
test('published messages for another source or conversation do not block the current acceptance', async () => {
  const f = await setup();
  f.db.patch('whatsappOutboundQueue', 'previous-turn-reply', { conversationId: CONV, sourceInboundMessageId: 'MSG-1', status: 'sent' });
  f.db.patch('whatsappOutboundQueue', 'another-conversation-reply', { conversationId: 'ANOTHER', sourceInboundMessageId: 'MSG-2', status: 'sent' });
  assert.equal((await f.respond(f.offer)).state, 'accepted');
  assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
});
test('an already committed acceptance still replays after its confirmation is queued without another model or move', async () => {
  const f = await setup(); await f.respond(f.offer);
  f.db.patch('businessSettings', 'customer-agent', { recoveryConfirmationEnabled: true, recoveryResponseRoutingEnabled: true });
  await createMayaRecoveryConfirmation({ db: f.db, clock: () => new Date(NOW.getTime() + 180000) }).enqueueIfCompleted({
    context: { conversationId: CONV, inboundMessageId: 'MSG-2', communicationAccountId: ACCOUNT,
      expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 },
  });
  const before = JSON.stringify([...f.db.docs]); const modelCalls = f.analysisCalls.length;
  assert.equal((await f.respond(f.offer)).replayed, true);
  assert.equal(f.analysisCalls.length, modelCalls); assert.equal(JSON.stringify([...f.db.docs]), before);
});
