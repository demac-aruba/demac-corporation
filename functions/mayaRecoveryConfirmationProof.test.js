'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-confirmation-proof', storageBucket: 'demo-maya-confirmation-proof.appspot.com' });
const { getFirestore } = require('firebase-admin/firestore');
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryConfirmation } = require('./mayaRecoveryConfirmation');
const { wacliCanonicalIdentity } = require('./wacliCommunicationBoundary');
const gateway = require('./whatsappWacliGateway');
const AT = NOW.getTime() + 180000;
const context = { conversationId: CONV, inboundMessageId: 'MSG-2', communicationAccountId: ACCOUNT,
  expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 };
async function setup() {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryConfirmationEnabled: true, recoveryResponseRoutingEnabled: true });
  const offer = await f.prepare(); await f.delivered(offer); f.inbound(); await f.respond(offer);
  return { ...f, offer, confirmation: createMayaRecoveryConfirmation({ db: f.db, clock: () => new Date(AT) }) };
}
for (const invalid of [null, [], false, 'not-a-receipt']) {
  test(`malformed completion ${JSON.stringify(invalid)} cannot resume the ordinary model after the offer pointer is removed`, async () => {
    const f = await setup(); let calls = 0;
    f.db.patch('whatsappMessages', 'MSG-2', { mayaRecoveryCompletion: invalid });
    f.db.patch('communicationConversations', CONV, { mayaRecoveryOffer: null });
    await assert.rejects(f.confirmation.runWithRecovery({ context, run: async () => { calls++; return { draft: 'Unverified' }; } }),
      { code: 'recovery_confirmation_completion_changed' });
    assert.equal(calls, 0); assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  });
}
test('a publication receipt without its completion pointer cannot silently fall back to the ordinary model', async () => {
  const f = await setup(); await f.confirmation.enqueueIfCompleted({ context });
  const message = { ...f.db.read('whatsappMessages', 'MSG-2') }; delete message.mayaRecoveryCompletion;
  f.db.docs.set('whatsappMessages/MSG-2', message); f.db.patch('communicationConversations', CONV, { mayaRecoveryOffer: null });
  await assert.rejects(f.confirmation.recover(context), { code: 'recovery_confirmation_completion_changed' });
});
test('an ACK retains the claimed remote identity even if conversation addressing changes after the claim', async t => {
  const f = await setup(); const firestore = getFirestore();
  t.mock.timers.enable({ apis: ['Date'], now: AT });
  t.mock.method(firestore, 'collection', name => f.db.collection(name));
  t.mock.method(firestore, 'runTransaction', (...args) => f.db.runTransaction(...args));
  const token = 'offline-proof-token'; const before = process.env.WACLI_BRIDGE_TOKEN; process.env.WACLI_BRIDGE_TOKEN = token;
  t.after(() => { if (before === undefined) delete process.env.WACLI_BRIDGE_TOKEN; else process.env.WACLI_BRIDGE_TOKEN = before; });
  const queued = await f.confirmation.enqueueIfCompleted({ context });
  const stored = f.db.read('whatsappOutboundQueue', queued.id);
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'proof-bridge', ACCOUNT, AT);
  const nextRemote = '2975600099@s.whatsapp.net';
  f.db.patch('communicationConversations', CONV, { remoteConversationId: nextRemote });
  const providerId = 'proof-original-remote-message';
  const expected = wacliCanonicalIdentity({ communicationAccountId: ACCOUNT, chat: stored.confirmationRemoteConversationId, providerMessageId: providerId });
  const headers = { authorization: `Bearer ${token}`, 'x-demac-communication-account-id': ACCOUNT };
  const req = { method: 'POST', body: { queueId: command.queueId, claimToken: command.claimToken, sent: true, messageId: providerId },
    get(name) { return headers[name.toLowerCase()]; } };
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }, set() { return this; }, on() { return this; } };
  await gateway.wacliOutboundAck(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body)); assert.equal(res.body.messageId, expected.messageId);
  assert.equal(f.db.read('whatsappMessages', expected.messageId).remoteConversationId, expected.remoteConversationId);
  assert.equal(f.db.read('communicationConversations', CONV).remoteConversationId, nextRemote);
});
