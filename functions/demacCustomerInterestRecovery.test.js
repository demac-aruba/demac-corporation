'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { createCustomerInterestRecovery, NAME } = require('./demacCustomerInterestRecovery');
const { createCustomerBookingInterestTools } = require('./demacCustomerBookingInterest');
const { loadHistoryWindow, recoveredInterestIsCurrent } = require('./demacCustomerInterestHistory');

const NOW = new Date('2026-09-08T15:00:00Z');
const CONV = `COMM-${'B'.repeat(40)}`;
const ACCOUNT = 'demac-wa-corporate';
const PHONE = '2975600000';
const QUOTE = 'Thursday is fine, but please let me know if an earlier appointment opens.';
const context = { conversationId: CONV, inboundMessageId: 'M2' };
function message(id, text, version, direction = 'inbound', minute = 0) {
  const at = new Date(Date.parse('2026-09-07T12:00:00Z') + minute * 60000).toISOString();
  return { id, messageId: id, conversationId: CONV, communicationAccountId: ACCOUNT,
    provider: 'wacli', channel: 'whatsapp', remoteConversationId: `${PHONE}@s.whatsapp.net`, phone: PHONE,
    direction, type: 'text', text, customerInputVersion: version, whatsappTimestamp: at, firstIngestedAtIso: at };
}
function database() {
  return new MemoryDb({
    businessSettings: [{ id: 'whatsapp', communicationAccountId: ACCOUNT }, { id: 'customer-agent', enabled: true,
      autoReplyEnabled: true, replyMode: 'allowlist', autoReplyAllowlist: [PHONE], bookingInterestEnabled: true, bookingInterestRecoveryEnabled: true }],
    communicationConversations: [{ id: CONV, communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp',
      remoteConversationId: `${PHONE}@s.whatsapp.net`, phone: PHONE, aiDisposition: 'ai_active', ownershipVersion: 2,
      customerInputVersion: 2, recentMessages: [{ id: 'M1' }, { id: 'O1' }, { id: 'M2' }] }],
    whatsappMessages: [message('M1', QUOTE, 1), message('O1', 'Your Thursday appointment is confirmed.', null, 'outbound', 1), message('M2', 'Thanks.', 2, 'inbound', 2)],
    customerAgentInboundQueue: [{ id: 'Q2', conversationId: CONV, communicationAccountId: ACCOUNT, messageId: 'M2', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 2 }],
    clients: [{ id: 'C1', name: 'Synthetic customer', phone: PHONE, whatsapp: PHONE, active: true }],
    properties: [{ id: 'P1', clientId: 'C1', address: 'Controlled test property', operationalZone: 'Test sector', active: true }],
    appointments: [{ id: 'APT1', customerId: 'C1', propertyId: 'P1', status: 'confirmed', date: '2026-09-10', startTime: '09:30', workLines: [{ presetId: 'standard_service', quantity: 1 }] }],
    workOrders: [{ id: 'WO1', appointmentId: 'APT1', status: 'Confirmada' }],
    bookingCapacityLocks: [{ id: 'LOCK1', appointmentId: 'APT1', active: true }],
  });
}
function decision(extra = {}) {
  return { caseId: '', kind: 'earlier_appointment', propertyId: 'P1', appointmentId: 'APT1', state: 'waiting',
    evidenceMessageId: 'M1', quote: QUOTE, confidence: 0.98, ambiguous: false, dateFrom: '', dateTo: '', ...extra };
}
function service(db, analyze = async () => [decision()]) {
  return createCustomerInterestRecovery({ db, analyze, clock: () => NOW, apiKeyProvider: () => 'synthetic-test-key' });
}
function scheduleSnapshot(db) { return JSON.stringify([...db.docs].filter(([path]) => /^(appointments|workOrders|bookingCapacityLocks)\//.test(path))); }
async function recover(db, analyze, ctx = context) { return service(db, analyze).invoke(NAME, {}, ctx); }
function appendMessage(db, id, text, version) {
  db.patch('whatsappMessages', id, message(id, text, version, 'inbound', version + 2));
  const conversation = db.read('communicationConversations', CONV);
  db.patch('communicationConversations', CONV, { customerInputVersion: version, recentMessages: [...conversation.recentMessages, { id }] });
  db.patch('customerAgentInboundQueue', `Q${version}`, { conversationId: CONV, communicationAccountId: ACCOUNT, messageId: id,
    expectedOwnershipVersion: 2, expectedCustomerInputVersion: version });
}

test('recovers an earlier request before thanks without changing the Thursday appointment or reserving capacity', async () => {
  const db = database(); const before = scheduleSnapshot(db);
  let inspected;
  const result = await recover(db, async ({ context: visible }) => { inspected = visible; return [decision()]; });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.results[0].state, 'WAITING'); assert.equal(result.capacityReserved, false); assert.equal(result.proactiveContactAuthorized, false);
  assert.equal(scheduleSnapshot(db), before);
  const record = db.read('communicationCases', result.results[0].caseId);
  assert.equal(record.lastSourceMessageId, 'M1'); assert.equal(record.bookingInterest.sourceQuote, QUOTE);
  assert.equal(record.interestHistory.at(-1).customerInputVersion, 1);
  assert.equal(record.interestReview.customerInputVersion, 2);
  assert.equal(record.bookingInterest.originalDate, '2026-09-10');
  assert.deepEqual(inspected.messages.map(item => item.id), ['M1', 'O1', 'M2']);
  assert.ok(db.writes.every(path => path.startsWith('communicationCases/') || path === `communicationConversations/${CONV}`));
});
test('exact replay does not call the model or append audit events twice', async () => {
  const db = database(); let calls = 0; const recovery = service(db, async () => { calls++; return [decision()]; });
  const first = await recovery.recover(context); const writes = db.writes.length;
  const second = await recovery.recover(context);
  assert.equal(second.replayed, true); assert.equal(calls, 1); assert.equal(db.writes.length, writes);
  assert.equal(db.read('communicationCases', first.results[0].caseId).interestHistory.length, 1);
});
test('later explicit withdrawal preserves appointment and original request in audit history', async () => {
  const db = database(); const first = await recover(db); assert.equal(first.success, true, JSON.stringify(first));
  const id = first.results[0].caseId; const before = scheduleSnapshot(db);
  const quote = 'Please keep Thursday and do not contact me about an earlier appointment.';
  appendMessage(db, 'M3', quote, 3);
  const result = await recover(db, async () => [decision({ caseId: id, state: 'withdrawn', evidenceMessageId: 'M3', quote })], { conversationId: CONV, inboundMessageId: 'M3' });
  assert.equal(result.success, true, JSON.stringify(result)); assert.equal(result.results[0].state, 'WITHDRAWN');
  assert.equal(scheduleSnapshot(db), before); const record = db.read('communicationCases', id);
  assert.equal(record.interestHistory[0].sourceQuote, QUOTE); assert.equal(record.interestHistory.at(-1).sourceQuote, quote);
});
test('an older positive quote cannot revive a withdrawn preference', async () => {
  const db = database(); const first = await recover(db); assert.equal(first.success, true, JSON.stringify(first)); const id = first.results[0].caseId;
  appendMessage(db, 'M3', 'No longer interested.', 3);
  const withdrawn = await recover(db, async () => [decision({ caseId: id, state: 'withdrawn', evidenceMessageId: 'M3', quote: 'No longer interested.' })], { conversationId: CONV, inboundMessageId: 'M3' });
  assert.equal(withdrawn.success, true, JSON.stringify(withdrawn));
  appendMessage(db, 'M4', 'Goodbye.', 4); const writes = db.writes.length;
  const result = await recover(db, async () => [decision({ caseId: id })], { conversationId: CONV, inboundMessageId: 'M4' });
  assert.equal(result.success, false); assert.equal(db.writes.length, writes); assert.equal(db.read('communicationCases', id).state, 'WITHDRAWN');
});
for (const [name, patch] of [
  ['recovery disabled', db => db.patch('businessSettings', 'customer-agent', { bookingInterestRecoveryEnabled: false })],
  ['capture disabled', db => db.patch('businessSettings', 'customer-agent', { bookingInterestEnabled: false })],
  ['reply disabled', db => db.patch('businessSettings', 'customer-agent', { autoReplyEnabled: false })],
  ['pilot removed', db => db.patch('businessSettings', 'customer-agent', { autoReplyAllowlist: [] })],
  ['operator takeover', db => db.patch('communicationConversations', CONV, { aiDisposition: 'human_active' })],
  ['missing queue', db => db.docs.delete('customerAgentInboundQueue/Q2')],
  ['wrong account', db => db.patch('businessSettings', 'whatsapp', { communicationAccountId: 'other-account' })],
]) test(`${name} stops recovery before any model call or write`, async () => {
  const db = database(); patch(db); let calls = 0;
  const result = await recover(db, async () => { calls++; return [decision()]; });
  assert.equal(result.success, false); assert.equal(calls, 0); assert.equal(db.writes.length, 0);
});
for (const [name, change] of [
  ['new customer input', db => appendMessage(db, 'M3', 'Actually leave Thursday.', 3)],
  ['operator takeover', db => db.patch('communicationConversations', CONV, { aiDisposition: 'human_active' })],
  ['allowlist revoked', db => db.patch('businessSettings', 'customer-agent', { autoReplyAllowlist: [] })],
  ['property reassigned', db => db.patch('properties', 'P1', { clientId: 'FOREIGN' })],
  ['appointment moved', db => db.patch('appointments', 'APT1', { startTime: '15:30' })],
  ['source edited', db => db.patch('whatsappMessages', 'M1', { text: 'Never requested that.' })],
]) test(`${name} during semantic analysis prevents stale commit`, async () => {
  const db = database(); const result = await recover(db, async () => { change(db); return [decision()]; });
  assert.equal(result.success, false); assert.equal(db.writes.length, 0);
});
test('low confidence and ambiguous reviews cannot become active waiting candidates', async () => {
  for (const extra of [{ confidence: 0.4 }, { ambiguous: true }]) {
    const db = database(); const result = await recover(db, async () => [decision(extra)]);
    assert.equal(result.success, true, JSON.stringify(result)); assert.equal(result.results[0].state, 'NEEDS_REVIEW');
  }
});
for (const extra of [
  { quote: 'Invented evidence' }, { propertyId: 'FOREIGN' }, { appointmentId: 'FOREIGN' },
  { evidenceMessageId: 'O1', quote: 'Your Thursday appointment is confirmed.' }, { confidence: '0.99' },
  { extra: true }, { dateFrom: '2026-02-30' },
]) test(`invalid review is rejected atomically: ${JSON.stringify(extra)}`, async () => {
  const db = database(); const result = await recover(db, async () => [decision(extra)]);
  assert.equal(result.success, false); assert.equal(db.writes.length, 0);
});
test('a failed final commit leaves no derived case or completion receipt', async () => {
  const db = database(); const before = scheduleSnapshot(db);
  const result = await recover(db, async () => { db.failCommit = true; return [decision()]; });
  assert.equal(result.success, false); assert.equal(db.writes.length, 0); assert.equal(scheduleSnapshot(db), before);
  assert.equal(db.read('communicationConversations', CONV).mayaInterestRecovery, undefined);
});
test('missing, foreign, reordered or unreadable original messages fail closed', async () => {
  for (const patch of [
    db => db.docs.delete('whatsappMessages/M1'),
    db => db.patch('whatsappMessages', 'M1', { communicationAccountId: 'other' }),
    db => db.patch('whatsappMessages', 'M1', { customerInputVersion: 9 }),
    db => db.patch('whatsappMessages', 'M1', { type: 'voice', transcriptionStatus: 'pending' }),
    db => db.patch('whatsappMessages', 'M2', { text: 'x'.repeat(6001) }),
  ]) {
    const db = database(); patch(db); let calls = 0;
    const result = await recover(db, async () => { calls++; return [decision()]; });
    assert.equal(result.success, false); assert.equal(calls, 0); assert.equal(db.writes.length, 0);
  }
});
test('completed audio is evidence but recovery does not transcribe historical audio', async () => {
  const db = database(); db.patch('whatsappMessages', 'M1', { type: 'voice', text: '', transcriptionStatus: 'completed', rawTranscript: QUOTE, transcriptionVersion: 'v1' });
  const result = await recover(db); assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(db.read('whatsappMessages', 'M1').rawTranscript, QUOTE);
  assert.ok(!db.writes.some(path => path.startsWith('whatsappMessages/')));
});
test('existing interest tool routes recover_recent without introducing another registry or caller target', async () => {
  const db = database(); const args = { action: 'recover_recent', kind: '', customerId: '', propertyId: '', appointmentId: '', sourceQuote: '', dateFrom: '', dateTo: '' };
  const tools = createCustomerBookingInterestTools({ db, historyRecovery: service(db) });
  assert.equal((await tools.invoke('record_booking_interest', args, context)).success, true);
  const writes = db.writes.length;
  assert.equal((await tools.invoke('record_booking_interest', { ...args, customerId: 'OTHER' }, context)).success, false);
  assert.equal(db.writes.length, writes);
});
test('unexpected model diagnostics are not exposed and cause no writes', async () => {
  const db = database(); const result = await recover(db, async () => { throw new Error('sensitive provider diagnostics'); });
  assert.equal(result.success, false); assert.doesNotMatch(JSON.stringify(result), /sensitive/); assert.equal(db.writes.length, 0);
});
test('batch entry is bounded and checks each conversation independently', async () => {
  const db = database(); const recovery = service(db);
  await assert.rejects(() => recovery.recoverMany({ conversationIds: Array(6).fill(CONV) }));
  const result = await recovery.recoverMany({ conversationIds: [CONV, 'MISSING'], apiKey: 'synthetic-test-key' });
  assert.equal(result.results[0].success, true, JSON.stringify(result)); assert.equal(result.results[1].success, false);
  assert.equal(result.proactiveContactAuthorized, false);
});
module.exports = { NOW, CONV, ACCOUNT, PHONE, QUOTE, context, database, decision, service, appendMessage };
