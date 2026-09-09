'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-confirmation-review', storageBucket: 'demo-maya-confirmation-review.appspot.com' });
const { getFirestore } = require('firebase-admin/firestore');
const { fixture, NOW, CONV, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryConfirmation, confirmationQueueId, ordinaryReplyId, recoveryConfirmationClaimDecision } = require('./mayaRecoveryConfirmation');
const { sessionIdentity } = require('./demacCustomerConversationState');
const communication = require('./demacCustomerAgentCommunication');
const gateway = require('./whatsappWacliGateway');
const AT = NOW.getTime() + 180000;
const context = () => ({ conversationId: CONV, inboundMessageId: 'MSG-2', communicationAccountId: ACCOUNT,
  expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 });
async function setup(t, accepted = true) {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryConfirmationEnabled: true, recoveryResponseRoutingEnabled: true });
  const offer = await f.prepare(); await f.delivered(offer); f.inbound();
  if (accepted) await f.respond(offer);
  t.mock.timers.enable({ apis: ['Date'], now: AT });
  const firestore = getFirestore();
  t.mock.method(firestore, 'collection', name => f.db.collection(name));
  t.mock.method(firestore, 'runTransaction', (...args) => f.db.runTransaction(...args));
  const proto = Object.getPrototypeOf(f.db.collection('review').doc('ref'));
  const prior = Object.getOwnPropertyDescriptor(proto, 'set');
  Object.defineProperty(proto, 'set', { configurable: true, value: function(value, options) {
    return this.db.runTransaction(transaction => transaction.set(this, value, options));
  } });
  t.after(() => { if (prior) Object.defineProperty(proto, 'set', prior); else delete proto.set; });
  return { ...f, offer, confirmation: createMayaRecoveryConfirmation({ db: f.db }) };
}

test('review: commitment between preflight and ordinary reply transaction blocks stale draft; retry publishes canonical confirmation only', async t => {
  const f = await setup(t, false); const actual = f.db.runTransaction.bind(f.db); let calls = 0; let injected = false;
  f.db.runTransaction = async (...args) => {
    calls++;
    if (calls === 2 && !injected) {
      injected = true;
      f.db.runTransaction = actual;
      await f.respond(f.offer);
    }
    return actual(...args);
  };
  const input = { ...context(), provider: 'wacli', result: { draft: 'Your old Thursday booking remains.', metadata: { outcome: 'reply' } } };
  await assert.rejects(communication.queueAgentReply(input), { code: 'recovery_confirmation_recheck_required' });
  assert.equal(injected, true); assert.equal(f.db.read('appointments', 'APT-1').date, '2026-09-08');
  assert.equal(f.db.read('whatsappOutboundQueue', ordinaryReplyId(CONV, 'MSG-2')), undefined);
  assert.equal(f.db.read('whatsappOutboundQueue', confirmationQueueId(CONV, 'MSG-2')), undefined);
  const retry = await communication.queueAgentReply(input);
  assert.equal(retry.id, confirmationQueueId(CONV, 'MSG-2')); assert.equal(retry.existing, false);
  assert.match(f.db.read('whatsappOutboundQueue', retry.id).text, /2026-09-08/);
  assert.equal(f.analysisCalls.length, 1);
});
test('review: a human session after a committed move is not reset before recovery by the real turn processor', async t => {
  const f = await setup(t); const id = sessionIdentity({ conversationId: CONV, provider: 'wacli', communicationAccountId: ACCOUNT }).sessionId;
  f.db.patch('customerAgentSessions', id, { status: 'HUMAN_ACTIVE', requiresHuman: true, communicationAccountId: ACCOUNT });
  f.db.patch('customerAgentInboundQueue', 'Q-2', { status: 'queued', provider: 'wacli', customerInputVersion: 5, attempts: 1 });
  let fetches = 0; t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('No network'); });
  await assert.rejects(communication.processLatestQueued(CONV, 'review-lease'), { code: 'recovery_confirmation_human_review' });
  assert.equal(f.db.read('customerAgentSessions', id).status, 'HUMAN_ACTIVE'); assert.equal(fetches, 0);
  assert.equal(f.db.read('whatsappOutboundQueue', confirmationQueueId(CONV, 'MSG-2')), undefined);
});
test('review: a lost queue document after publication is not interpreted as permission to resend', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  f.db.docs.delete(`whatsappOutboundQueue/${queued.id}`); const snapshot = JSON.stringify([...f.db.docs]);
  await assert.rejects(f.confirmation.enqueueIfCompleted({ context: context() }), { code: 'recovery_confirmation_publication_missing' });
  assert.equal(JSON.stringify([...f.db.docs]), snapshot);
});
test('review: missing publication receipt blocks an otherwise well-formed confirmation at claim', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  f.db.patch('whatsappMessages', 'MSG-2', { mayaRecoveryConfirmationQueued: null });
  const command = await gateway.claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, AT);
  assert.equal(command, null);
  assert.equal(f.db.read('whatsappOutboundQueue', queued.id).recoveryAuthorizationReason, 'recovery_confirmation_publication_changed');
});
test('review: a changed completion pointer is not silently rebuilt from the same offer', async t => {
  const f = await setup(t); f.db.patch('whatsappMessages', 'MSG-2', { mayaRecoveryCompletion: { version: 1, offerId: f.offer.offerId,
    offerVersion: f.offer.offerVersion, appointmentId: 'OTHER', responseFingerprint: 'wrong' } });
  await assert.rejects(f.confirmation.recover(context()), { code: 'recovery_confirmation_completion_changed' });
});
test('review: clearing only the completion pointer requires reconciliation rather than implicit backfill', async t => {
  const f = await setup(t); const source = { ...f.db.read('whatsappMessages', 'MSG-2') }; delete source.mayaRecoveryCompletion;
  f.db.docs.set('whatsappMessages/MSG-2', source);
  await assert.rejects(f.confirmation.recover(context()), { code: 'recovery_confirmation_completion_changed' });
});
test('review: remote identity changed before claim invalidates the queued canonical identity', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  f.db.patch('communicationConversations', CONV, { remoteConversationId: 'different-remote@s.whatsapp.net' });
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, AT), null);
  assert.equal(f.db.read('whatsappOutboundQueue', queued.id).status, 'failed');
});
test('review: mixing offer and confirmation markers cannot open the wrong ACK path', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  f.db.patch('whatsappOutboundQueue', queued.id, { recoveryOfferId: f.offer.offerId, recoveryOfferVersion: f.offer.offerVersion });
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, AT), null);
});
test('review: another queued reply introduced after publication blocks the real confirmation claim', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  f.db.patch('whatsappOutboundQueue', ordinaryReplyId(CONV, 'MSG-2'), { text: 'Competing confirmation', status: 'failed', provider: 'wacli', communicationAccountId: ACCOUNT });
  assert.equal(await gateway.claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, AT), null);
  assert.equal(f.db.read('whatsappOutboundQueue', queued.id).recoveryAuthorizationReason, 'recovery_confirmation_other_reply_exists');
});
test('review: snapshot failure during final confirmation claim propagates and does not destroy queued work', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  const before = JSON.stringify([...f.db.docs]); const snapshot = f.db.snapshot.bind(f.db);
  f.db.snapshot = ref => { if (ref.path === 'appointments/APT-1') throw new Error('Synthetic snapshot outage'); return snapshot(ref); };
  await assert.rejects(gateway.claimOutboundCommandWithDb(f.db, 'review-bridge', ACCOUNT, AT), /Synthetic snapshot outage/);
  assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.db.read('whatsappOutboundQueue', queued.id).status, 'queued');
});
test('review: claimed payload proof is required before a caller can replay a supposedly sent confirmation', async t => {
  const f = await setup(t); const queued = await f.confirmation.enqueueIfCompleted({ context: context() });
  f.db.patch('whatsappOutboundQueue', queued.id, { status: 'sent' });
  await assert.rejects(f.confirmation.enqueueIfCompleted({ context: context() }), { code: 'recovery_confirmation_reconciliation_required' });
});
