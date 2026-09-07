const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { NAME, DEFINITION, createCustomerBookingInterestTools, normalizeInterest } = require('./demacCustomerBookingInterest');
const { createMayaOperationsReadModel } = require('./mayaOperationsReadModel');
const CONV = `COMM-${'A'.repeat(40)}`;
const ACCOUNT = 'demac-wa-corporate';
const PHONE = '2975600000';
const NOW = new Date('2026-09-06T18:00:00Z');
const clock = () => NOW;
const context = { conversationId: CONV, inboundMessageId: 'MSG-1' };
const input = { action: 'register', kind: 'earlier_appointment', customerId: 'C-1', propertyId: 'P-1', appointmentId: 'APT-1', sourceQuote: 'Can you come earlier?', dateFrom: '', dateTo: '' };
function seed() {
  const communication = { communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp', remoteConversationId: `${PHONE}@s.whatsapp.net`, phone: PHONE };
  return {
    businessSettings: [{ id: 'customer-agent', enabled: true, autoReplyEnabled: true, replyMode: 'allowlist', autoReplyAllowlist: [PHONE], bookingInterestEnabled: true, autoCancelEnabled: false, autoRescheduleEnabled: false }, { id: 'whatsapp', communicationAccountId: ACCOUNT }],
    communicationConversations: [{ id: CONV, ...communication, aiDisposition: 'ai_active', ownershipVersion: 2, customerInputVersion: 4 }],
    whatsappMessages: [{ id: 'MSG-1', messageId: 'MSG-1', ...communication, conversationId: CONV, direction: 'inbound', text: input.sourceQuote, customerInputVersion: 4 }],
    customerAgentInboundQueue: [{ id: 'QUEUE-1', communicationAccountId: ACCOUNT, conversationId: CONV, messageId: 'MSG-1', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 4 }],
    clients: [{ id: 'C-1', name: 'Controlled test customer', active: true, phone: PHONE, whatsapp: PHONE }],
    properties: [{ id: 'P-1', clientId: 'C-1', active: true, address: 'Controlled test property', operationalZone: 'Test sector' }],
    appointments: [{ id: 'APT-1', customerId: 'C-1', propertyId: 'P-1', status: 'confirmed', date: '2026-09-10', startTime: '09:30', workLines: [{ presetId: 'standard_service', quantity: 2 }] }],
    workOrders: [{ id: 'WO-1', appointmentId: 'APT-1', status: 'Confirmada' }],
    bookingCapacityLocks: [{ id: 'LOCK-1', appointmentId: 'APT-1', active: true }],
  };
}
async function run(db, args = input, ctx = context) { return createCustomerBookingInterestTools({ db, clock }).invoke(NAME, args, ctx); }
function advance(db, text) {
  const original = db.read('whatsappMessages', 'MSG-1');
  db.patch('communicationConversations', CONV, { customerInputVersion: 5 });
  db.patch('whatsappMessages', 'MSG-2', { ...original, messageId: 'MSG-2', text, customerInputVersion: 5 });
  db.patch('customerAgentInboundQueue', 'QUEUE-2', { communicationAccountId: ACCOUNT, conversationId: CONV, messageId: 'MSG-2', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 });
  return { conversationId: CONV, inboundMessageId: 'MSG-2' };
}

test('waiting preference is a strict evidence-backed tool, not another booking tool', () => {
  assert.equal(DEFINITION.strict, true);
  assert.equal(DEFINITION.parameters.additionalProperties, false);
  assert.deepEqual(Object.keys(DEFINITION.parameters.properties), DEFINITION.parameters.required);
});
test('earlier-date request keeps Thursday appointment, work order and capacity exactly unchanged', async () => {
  const db = new MemoryDb(seed());
  const before = JSON.stringify([db.read('appointments', 'APT-1'), db.read('workOrders', 'WO-1'), db.read('bookingCapacityLocks', 'LOCK-1')]);
  const result = await run(db);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.state, 'WAITING');
  assert.equal(result.capacityReserved, false);
  assert.equal(result.proactiveContactAuthorized, false);
  assert.equal(JSON.stringify([db.read('appointments', 'APT-1'), db.read('workOrders', 'WO-1'), db.read('bookingCapacityLocks', 'LOCK-1')]), before);
  assert.ok(db.writes.every(path => path.startsWith('communicationCases/')));
  const page = await createMayaOperationsReadModel({ db, clock }).listWaitlist();
  assert.equal(page.rows[0].originalDate, '2026-09-10');
  assert.equal(page.rows[0].preference, input.sourceQuote);
  assert.equal(page.rows[0].state, 'waiting');
  assert.equal(page.rows[0].canContact, false);
});
test('customer without a booking can register a separate new-appointment preference', async () => {
  const db = new MemoryDb(seed());
  db.docs.delete('appointments/APT-1');
  const result = await run(db, { ...input, kind: 'new_appointment', appointmentId: '' });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(db.read('communicationCases', result.caseId).bookingInterest.originalDate, '');
  assert.equal(db.writes.length, 1);
});
test('replayed current input records one preference and one audit event', async () => {
  const db = new MemoryDb(seed());
  const first = await run(db); const second = await run(db);
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(second.replayed, true);
  assert.equal(second.caseId, first.caseId);
  assert.equal(db.writes.length, 1);
  assert.equal(db.read('communicationCases', first.caseId).interestHistory.length, 1);
});
test('same-turn material change fails with an idempotency conflict', async () => {
  const db = new MemoryDb(seed()); await run(db);
  const result = await run(db, { ...input, dateTo: '2026-09-09' });
  assert.equal(result.success, false); assert.equal(result.error.code, 'idempotency_conflict');
});
test('customer can withdraw interest in a newer turn without cancelling the original booking', async () => {
  const db = new MemoryDb(seed()); const first = await run(db);
  const text = 'Please keep Thursday; no earlier appointment.';
  const ctx = advance(db, text);
  const result = await run(db, { ...input, action: 'withdraw', sourceQuote: text }, ctx);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.caseId, first.caseId); assert.equal(result.state, 'WITHDRAWN');
  assert.equal(db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(db.read('communicationCases', first.caseId).interestHistory.length, 2);
});
for (const [title, collection, id, patch] of [
  ['disabled capture', 'businessSettings', 'customer-agent', { bookingInterestEnabled: false }],
  ['global Maya disable', 'businessSettings', 'customer-agent', { enabled: false }],
  ['reply kill switch', 'businessSettings', 'customer-agent', { autoReplyEnabled: false }],
  ['revoked allowlist', 'businessSettings', 'customer-agent', { autoReplyAllowlist: [] }],
  ['human takeover', 'communicationConversations', CONV, { ownerUserId: 'OPERATOR', aiDisposition: 'human_active' }],
  ['takeover then return', 'communicationConversations', CONV, { ownershipVersion: 3 }],
  ['newer customer input', 'communicationConversations', CONV, { customerInputVersion: 5 }],
  ['wrong active account', 'businessSettings', 'whatsapp', { communicationAccountId: 'other-account' }],
  ['foreign source message', 'whatsappMessages', 'MSG-1', { conversationId: 'OTHER' }],
  ['outbound source', 'whatsappMessages', 'MSG-1', { direction: 'outbound' }],
  ['foreign property', 'properties', 'P-1', { clientId: 'OTHER' }],
  ['foreign appointment', 'appointments', 'APT-1', { customerId: 'OTHER' }],
  ['cancelled appointment', 'appointments', 'APT-1', { status: 'cancelled' }],
]) test(`${title} cannot persist a waiting preference`, async () => {
  const db = new MemoryDb(seed()); db.patch(collection, id, patch);
  const result = await run(db); assert.equal(result.success, false, JSON.stringify(result)); assert.equal(db.writes.length, 0);
});
test('invented quotation cannot become customer evidence', async () => {
  const db = new MemoryDb(seed()); const result = await run(db, { ...input, sourceQuote: 'The customer never wrote this.' });
  assert.equal(result.error.code, 'evidence_missing'); assert.equal(db.writes.length, 0);
});
test('incomplete audio cannot become a waiting preference; a completed current transcript can', async () => {
  const db = new MemoryDb(seed());
  db.patch('whatsappMessages', 'MSG-1', { mediaType: 'audio', text: '[Audio]', transcriptionStatus: 'processing' });
  assert.equal((await run(db)).success, false);
  db.patch('whatsappMessages', 'MSG-1', { transcriptionStatus: 'completed', transcript: input.sourceQuote, rawTranscript: input.sourceQuote });
  const result = await run(db); assert.equal(result.success, true, JSON.stringify(result));
});
test('failed commit leaves no waiting request or schedule changes', async () => {
  const db = new MemoryDb(seed()); db.failCommit = true;
  assert.equal((await run(db)).success, false);
  assert.equal(db.writes.length, 0);
  assert.equal([...db.docs.keys()].some(path => path.startsWith('communicationCases/')), false);
});
test('structured date validation rejects impossible, reversed and past deadlines', () => {
  for (const patch of [{ dateTo: '2026-02-30' }, { dateFrom: '2026-09-12', dateTo: '2026-09-09' }, { dateTo: '2026-09-01' }]) {
    assert.throws(() => normalizeInterest({ ...input, ...patch }, '2026-09-06'));
  }
});
test('missing current queue receipt and ambiguous customer identity fail closed', async () => {
  const db = new MemoryDb(seed()); db.docs.delete('customerAgentInboundQueue/QUEUE-1');
  assert.equal((await run(db)).success, false);
  const ambiguous = new MemoryDb(seed()); ambiguous.patch('clients', 'C-2', { phone: PHONE, active: true });
  assert.equal((await run(ambiguous)).success, false); assert.equal(ambiguous.writes.length, 0);
});
