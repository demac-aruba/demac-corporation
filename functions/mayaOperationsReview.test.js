const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { NAME, bookingInterestCaseId, createCustomerBookingInterestTools } = require('./demacCustomerBookingInterest');
const { cancellationRow, waitlistRow, timeKey } = require('./mayaOperationsReadModel');
const NOW = new Date('2026-09-06T18:00:00Z'); // 14:00 Aruba
const CONV = `COMM-${'B'.repeat(40)}`;
const PHONE = '2975600000';
const ACCOUNT = 'demac-wa-corporate';
const input = { action: 'register', kind: 'earlier_appointment', customerId: 'C-1', propertyId: 'P-1', appointmentId: 'APT-1', sourceQuote: 'Can you come earlier?', dateFrom: '', dateTo: '' };
const context = { conversationId: CONV, inboundMessageId: 'MSG-1' };
function database() {
  const comms = { communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp', remoteConversationId: `${PHONE}@s.whatsapp.net`, phone: PHONE };
  return new MemoryDb({
    businessSettings: [{ id: 'whatsapp', communicationAccountId: ACCOUNT }, { id: 'customer-agent', enabled: true, autoReplyEnabled: true, replyMode: 'allowlist', autoReplyAllowlist: [PHONE], bookingInterestEnabled: true }],
    communicationConversations: [{ id: CONV, ...comms, aiDisposition: 'ai_active', ownershipVersion: 2, customerInputVersion: 4 }],
    whatsappMessages: [{ id: 'MSG-1', ...comms, conversationId: CONV, direction: 'inbound', text: input.sourceQuote, customerInputVersion: 4 }],
    customerAgentInboundQueue: [{ id: 'Q-1', communicationAccountId: ACCOUNT, conversationId: CONV, messageId: 'MSG-1', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 4 }],
    clients: [{ id: 'C-1', name: 'Controlled test', phone: PHONE, whatsapp: PHONE, active: true }],
    properties: [{ id: 'P-1', clientId: 'C-1', active: true }],
    appointments: [{ id: 'APT-1', customerId: 'C-1', propertyId: 'P-1', status: 'confirmed', date: '2026-09-10', startTime: '09:30' }],
  });
}
async function record(db, args = input, ctx = context) {
  return createCustomerBookingInterestTools({ db, clock: () => NOW }).invoke(NAME, args, ctx);
}
test('incomplete cancellation identity and null work lines render reviewable history instead of crashing', () => {
  const row = cancellationRow({ id: 'APT-EMPTY', status: 'cancelled', workLines: [null, undefined, 'broken', { presetId: 'service', quantity: 1 }] }, null, null);
  assert.equal(row.identityVerified, false);
  assert.equal(row.customer, 'Customer record unavailable');
  assert.equal(row.address, '');
  assert.deepEqual(row.workLines, [{ service: 'service', quantity: 1 }]);
});
test('malformed waiting details are not presented as valid customer requests', () => {
  for (const bookingInterest of [null, [], 'invalid', { kind: 'invalid' }]) {
    assert.equal(waitlistRow({ caseType: 'booking_interest', bookingInterest }, null, null, null, '2026-09-06'), null);
  }
});
test('only exact valid 24-hour times are used for same-day eligibility', () => {
  assert.equal(timeKey('09:30'), '09:30');
  for (const time of ['9:30', '24:00', '12:60', 'tomorrow', null]) assert.equal(timeKey(time), '');
});
test('same-day booking whose time has passed is expired in the read projection, without changing persistence', () => {
  const appointment = { id: 'APT-1', customerId: 'C-1', propertyId: 'P-1', status: 'confirmed', date: '2026-09-06', startTime: '13:30' };
  const request = { id: 'CASE-1', caseType: 'booking_interest', state: 'WAITING', customerId: 'C-1', propertyId: 'P-1', bookingInterest: { kind: 'earlier_appointment', originalDate: appointment.date, originalTime: appointment.startTime } };
  const row = waitlistRow(request, { id: 'C-1' }, { id: 'P-1', clientId: 'C-1' }, appointment, '2026-09-06', '14:00');
  assert.equal(row.state, 'expired'); assert.equal(request.state, 'WAITING'); assert.equal(row.canContact, false);
});
test('capture rejects an elapsed same-day appointment and an invalid appointment time', async () => {
  for (const patch of [{ date: '2026-09-06', startTime: '13:30' }, { startTime: '' }, { startTime: '24:00' }]) {
    const db = database(); db.patch('appointments', 'APT-1', patch);
    const result = await record(db); assert.equal(result.success, false, JSON.stringify(result));
    assert.equal(result.error.code, 'appointment_changed'); assert.equal(db.writes.length, 0);
  }
});
test('an earlier-request date window cannot extend after the original booking', async () => {
  const db = database();
  const result = await record(db, { ...input, dateTo: '2026-09-12' });
  assert.equal(result.success, false); assert.equal(result.error.code, 'invalid_request'); assert.equal(db.writes.length, 0);
});
test('withdrawal keeps prior booking evidence and never reads a now-foreign appointment', async () => {
  const db = database(); const first = await record(db); assert.equal(first.success, true, JSON.stringify(first));
  const quote = 'Please leave the appointment as it is.';
  db.patch('appointments', 'APT-1', { customerId: 'FOREIGN-CUSTOMER', date: '2026-09-21', startTime: '15:30' });
  db.patch('communicationConversations', CONV, { customerInputVersion: 5 });
  db.patch('whatsappMessages', 'MSG-2', { ...db.read('whatsappMessages', 'MSG-1'), text: quote, customerInputVersion: 5 });
  db.patch('customerAgentInboundQueue', 'Q-2', { communicationAccountId: ACCOUNT, conversationId: CONV, messageId: 'MSG-2', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 });
  db.reads.length = 0;
  const result = await record(db, { ...input, action: 'withdraw', sourceQuote: quote }, { ...context, inboundMessageId: 'MSG-2' });
  assert.equal(result.success, true, JSON.stringify(result)); assert.equal(result.state, 'WITHDRAWN');
  const stored = db.read('communicationCases', first.caseId);
  assert.equal(stored.bookingInterest.originalDate, '2026-09-10');
  assert.equal(stored.bookingInterest.originalTime, '09:30');
  assert.equal(db.reads.includes('appointments/APT-1'), false);
});
test('long shared property identifiers cannot truncate away appointment or customer identity', () => {
  const long = { ...input, propertyId: `P-${'shared'.repeat(25)}` };
  const first = bookingInterestCaseId(long, ACCOUNT, CONV);
  assert.equal(first, bookingInterestCaseId({ ...long }, ACCOUNT, CONV));
  const variants = [
    { ...long, appointmentId: 'APT-2' },
    { ...long, customerId: 'C-2' },
    { ...long, propertyId: `${long.propertyId}-other` },
    { ...long, kind: 'new_appointment', appointmentId: '' },
  ];
  const ids = [first, ...variants.map(value => bookingInterestCaseId(value, ACCOUNT, CONV)),
    bookingInterestCaseId(long, 'other-account', CONV),
    bookingInterestCaseId(long, ACCOUNT, `COMM-${'C'.repeat(40)}`)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^COMMCASE-[A-F0-9]{40}$/.test(id)));
});
test('stored waiting preference with mismatched appointment or kind cannot be replayed or overwritten', async () => {
  for (const mismatch of ['appointment', 'kind']) {
    const db = database();
    const first = await record(db); assert.equal(first.success, true, JSON.stringify(first));
    const prior = db.read('communicationCases', first.caseId);
    db.patch('communicationCases', first.caseId, mismatch === 'appointment'
      ? { appointmentId: 'APT-OTHER' }
      : { bookingInterest: { ...prior.bookingInterest, kind: 'new_appointment' } });
    const protectedBefore = JSON.stringify(db.read('appointments', 'APT-1'));
    db.writes.length = 0;
    const result = await record(db);
    assert.equal(result.success, false); assert.equal(result.error.code, 'identity_mismatch');
    assert.equal(db.writes.length, 0);
    assert.equal(JSON.stringify(db.read('appointments', 'APT-1')), protectedBefore);
  }
});
