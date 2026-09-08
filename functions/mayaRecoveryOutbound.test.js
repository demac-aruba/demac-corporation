'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp({ projectId: 'demo-maya-recovery-tests', storageBucket: 'demo-maya-recovery-tests.appspot.com' });
const { fixture, NOW, CONV, PHONE, ACCOUNT } = require('./test-support/mayaRecoveryOffersFixture');
const { createMayaRecoveryOfferOutbound, configuredContactPolicy, recoveryQueueId, isRecoveryOutbound } = require('./mayaRecoveryOfferOutbound');
const { claimOutboundCommandWithDb } = require('./whatsappWacliGateway');
const POLICY = { version: 1, provider: 'wacli', timezone: 'America/Aruba', windows: [{ weekday: 1, start: '07:00', end: '08:00' }],
  cooldownMinutes: 60, minimumRemainingSeconds: 60 };
async function setup() {
  const f = await fixture();
  f.db.patch('businessSettings', 'customer-agent', { recoveryOutreachEnabled: true, recoveryContactPolicy: structuredClone(POLICY) });
  const offer = await f.prepare();
  let now = new Date(NOW);
  const sender = createMayaRecoveryOfferOutbound({ db: f.db, clock: () => now });
  f.db.writes.length = 0;
  return { ...f, offer, enqueue: () => sender.enqueue({ offerId: offer.offerId, offerVersion: offer.offerVersion }),
    setDispatchTime: value => { now = new Date(value); }, claim: () => claimOutboundCommandWithDb(f.db, 'test-bridge', ACCOUNT, now.getTime()) };
}
function domain(db) {
  return JSON.stringify([...db.docs].filter(([path]) => ['appointments/', 'workOrders/', 'bookingCapacityLocks/'].some(prefix => path.startsWith(prefix))));
}
test('queue producer enqueues once from the immutable offer and never sends or modifies scheduling', async () => {
  const f = await setup(); const before = domain(f.db);
  const first = await f.enqueue(); const writes = f.db.writes.length;
  const again = await f.enqueue();
  assert.equal(first.status, 'queued'); assert.equal(again.replayed, true); assert.equal(again.queueId, first.queueId);
  assert.equal(f.db.writes.length, writes); assert.equal(domain(f.db), before);
  const q = f.db.read('whatsappOutboundQueue', first.queueId);
  assert.equal(q.to, PHONE); assert.equal(q.text, f.offer.messageText); assert.equal(q.outboundClass, 'conversation_maya');
  assert.equal(first.capacityReserved, false); assert.equal(q.recoveryOfferVersion, f.offer.offerVersion);
  assert.equal([...f.db.docs.keys()].filter(path => path.startsWith('whatsappOutboundQueue/')).length, 1);
});
test('actual Wacli poll claims a valid queued recovery offer with a single attempt marker', async () => {
  const f = await setup(); const queued = await f.enqueue(); const before = domain(f.db);
  const command = await f.claim();
  assert.equal(command.queueId, queued.queueId); assert.equal(command.to, PHONE); assert.equal(command.text, f.offer.messageText);
  assert.ok(command.claimToken); assert.equal(domain(f.db), before);
  assert.equal(f.db.read('whatsappOutboundQueue', queued.queueId).recoveryDispatchAttemptedAtIso, NOW.toISOString());
});
for (const [label, modify] of [
  ['outreach off', f => f.db.patch('businessSettings', 'customer-agent', { recoveryOutreachEnabled: false })],
  ['Maya off', f => f.db.patch('businessSettings', 'customer-agent', { enabled: false })],
  ['phone revoked', f => f.db.patch('businessSettings', 'customer-agent', { autoReplyAllowlist: [] })],
  ['account switched', f => f.db.patch('businessSettings', 'whatsapp', { communicationAccountId: 'another-account' })],
  ['operator takeover', f => f.db.patch('communicationConversations', CONV, { ownerUserId: 'office-test', aiDisposition: 'human_active' })],
  ['new inbound', f => f.db.patch('communicationConversations', CONV, { customerInputVersion: 5 })],
  ['original moved', f => f.db.patch('appointments', 'APT-1', { date: '2026-09-11' })],
  ['source edited', f => f.db.patch('whatsappMessages', 'MSG-1', { text: 'No, leave Thursday unchanged.' })],
  ['preference withdrawn', f => f.db.patch('communicationCases', f.caseId, { state: 'WITHDRAWN' })],
  ['slot reoccupied', f => f.db.patch('bookingCapacityLocks', f.targetLocks[0].id, { active: true, appointmentId: 'OTHER' })],
  ['original work started', f => f.db.patch('workOrders', 'WO-APT-1-1', { status: 'En progreso' })],
  ['property reassigned', f => f.db.patch('properties', 'P-1', { clientId: 'OTHER' })],
  ['policy missing', f => f.db.patch('businessSettings', 'customer-agent', { recoveryContactPolicy: null })],
  ['offer expired', f => f.setDispatchTime(NOW.getTime() + 35 * 60000)],
  ['outside Aruba contact hours', f => f.setDispatchTime(NOW.getTime() - 60000)],
  ['too little time to respond', f => f.setDispatchTime(NOW.getTime() + 29.5 * 60000)],
]) {
  test(`${label} blocks enqueue without partial writes`, async () => {
    const f = await setup(); modify(f); const before = JSON.stringify([...f.db.docs]);
    await assert.rejects(f.enqueue); assert.equal(JSON.stringify([...f.db.docs]), before); assert.equal(f.db.writes.length, 0);
  });
  test(`${label} after enqueue is checked again by the actual transport claim`, async () => {
    const f = await setup(); const queued = await f.enqueue(); modify(f); const before = domain(f.db);
    assert.equal(await f.claim(), null); assert.equal(domain(f.db), before);
    assert.equal(f.db.read('whatsappOutboundQueue', queued.queueId).status, 'failed');
  });
}
test('changing the configured policy after enqueue invalidates the recorded send permission', async () => {
  const f = await setup(); const queued = await f.enqueue();
  f.db.patch('businessSettings', 'customer-agent', { recoveryContactPolicy: { ...POLICY, cooldownMinutes: 90 } });
  assert.equal(await f.claim(), null);
  assert.equal(f.db.read('whatsappOutboundQueue', queued.queueId).recoveryAuthorizationReason, 'recovery_outbound_identity_changed');
});
for (const [label, patch] of [['recipient', { to: '2975609999' }], ['text', { text: 'Changed offer' }],
  ['class', { outboundClass: 'transactional' }], ['media', { media: { url: 'https://example.invalid/test' } }],
  ['version', { recoveryOfferVersion: 99 }], ['fingerprint', { recoveryOfferFingerprint: 'changed' }]]) {
  test(`modified queue ${label} cannot bypass claim verification`, async () => {
    const f = await setup(); const q = await f.enqueue(); f.db.patch('whatsappOutboundQueue', q.queueId, patch);
    assert.equal(await f.claim(), null); assert.equal(f.db.read('whatsappOutboundQueue', q.queueId).status, 'failed');
  });
}
test('removing all recovery fields does not bypass the recovery queue-ID boundary', async () => {
  const f = await setup(); const q = await f.enqueue();
  const item = { ...f.db.read('whatsappOutboundQueue', q.queueId), outboundClass: 'transactional' };
  for (const key of Object.keys(item)) if (key.startsWith('recovery')) delete item[key];
  f.db.docs.set(`whatsappOutboundQueue/${q.queueId}`, item);
  assert.equal(await f.claim(), null); assert.equal(isRecoveryOutbound(q.queueId, item), true);
});
test('an expired transport lease is uncertain delivery, not permission to resend recovery offers', async () => {
  const f = await setup(); const q = await f.enqueue(); await f.claim();
  f.setDispatchTime(NOW.getTime() + 4 * 60000);
  assert.equal(await f.claim(), null);
  assert.equal(f.db.read('whatsappOutboundQueue', q.queueId).recoveryAuthorizationReason, 'recovery_delivery_requires_reconciliation');
});
test('ordinary transactional retry is unchanged and does not load recovery settings', async () => {
  const f = await fixture(); f.db.patch('whatsappOutboundQueue', 'ordinary', { provider: 'wacli', communicationAccountId: ACCOUNT,
    outboundClass: 'transactional', status: 'processing', leaseUntil: '2026-09-01T00:00:00Z', to: PHONE, text: 'Test reminder' });
  f.db.reads.length = 0;
  assert.equal((await claimOutboundCommandWithDb(f.db, 'test', ACCOUNT, NOW.getTime())).queueId, 'ordinary');
  assert.equal(f.db.reads.includes('businessSettings/customer-agent'), false);
});
test('cooldown and rollback preserve the existing queue and scheduling boundaries', async () => {
  const f = await setup();
  f.db.patch('communicationConversations', CONV, { mayaRecoveryLastQueuedAtIso: new Date(NOW.getTime() - 60000).toISOString() });
  await assert.rejects(f.enqueue, e => e.code === 'recovery_contact_cooldown');
  f.db.patch('communicationConversations', CONV, { mayaRecoveryLastQueuedAtIso: null });
  const before = JSON.stringify([...f.db.docs]); f.db.failCommit = true;
  await assert.rejects(f.enqueue); assert.equal(JSON.stringify([...f.db.docs]), before);
});
test('database failure during claim is not recorded as a permanent authorization failure', async () => {
  const f = await setup(); const q = await f.enqueue(); const before = JSON.stringify([...f.db.docs]);
  const snapshot = f.db.snapshot.bind(f.db);
  f.db.snapshot = ref => { if (ref.path === 'businessSettings/customer-agent') throw new Error('Synthetic storage unavailable'); return snapshot(ref); };
  await assert.rejects(f.claim); assert.equal(JSON.stringify([...f.db.docs]), before);
  assert.equal(f.db.read('whatsappOutboundQueue', q.queueId).status, 'queued');
});
test('policy is explicit, uses Aruba time, and rejects guessed or invalid defaults', () => {
  for (const policy of [null, {}, { ...POLICY, timezone: 'America/El_Salvador' }, { ...POLICY, provider: 'meta' },
    { ...POLICY, windows: [{ weekday: 1, start: '22:00', end: '08:00' }] }, { ...POLICY, cooldownMinutes: -1 }]) {
    assert.throws(() => configuredContactPolicy({ recoveryOutreachEnabled: true, recoveryContactPolicy: policy }));
  }
  assert.notEqual(recoveryQueueId('OFR-TEST', 1), recoveryQueueId('OFR-TEST', 2));
});
test('caller cannot override queue recipient or content', async () => {
  const f = await setup();
  await assert.rejects(() => createMayaRecoveryOfferOutbound({ db: f.db, clock: () => NOW }).enqueue({
    offerId: f.offer.offerId, offerVersion: f.offer.offerVersion, text: 'override' }));
  assert.equal(f.db.writes.length, 0);
});
