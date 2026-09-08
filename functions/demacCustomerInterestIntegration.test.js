'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { createCustomerBookingInterestTools } = require('./demacCustomerBookingInterest');
const { createCustomerInterestRecovery } = require('./demacCustomerInterestRecovery');
const { digest, recoveredInterestIsCurrent } = require('./demacCustomerInterestHistory');
const { buildCapacityLocks } = require('./bookingAuthoritySchedulingProvider');
const { createMayaRecoveryMatching } = require('./mayaRecoveryMatching');

const NOW = new Date('2026-09-07T11:00:00Z'); // Monday, 07:00 Aruba
const CONV = `COMM-${'C'.repeat(40)}`;
const ACCOUNT = 'demac-wa-corporate';
const PHONE = '2975600000';
const QUOTE = 'Can you come earlier?';
const WORK = [{ id: 'work-1', presetId: 'standard_service', serviceId: 's1', quantity: 1 }];
function originalMessage(id, text, version, direction = 'inbound') {
  const timestamp = `2026-09-07T10:${String(version || 0).padStart(2, '0')}:00Z`;
  return { id, messageId: id, conversationId: CONV, communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp',
    phone: PHONE, remoteConversationId: `${PHONE}@s.whatsapp.net`, direction, type: 'text', text,
    customerInputVersion: direction === 'inbound' ? version : null, whatsappTimestamp: timestamp, firstIngestedAtIso: timestamp };
}
function database() {
  const a = { vanId: 'VAN-1', vanName: 'Van 1', role: 'primary', time: '09:30', endTime: '10:30', slots: 1, quantity: 1,
    durationMinutes: 60, technicianIds: ['driver-1'] };
  const option = { date: '2026-09-08', time: '09:30', endTime: '10:30', assignments: [a] };
  const locks = buildCapacityLocks(option);
  return new MemoryDb({
    businessSettings: [{ id: 'whatsapp', communicationAccountId: ACCOUNT }, { id: 'customer-agent', enabled: true,
      autoReplyEnabled: true, replyMode: 'allowlist', autoReplyAllowlist: [PHONE], bookingInterestEnabled: true, bookingInterestRecoveryEnabled: true },
      { id: 'business-calendar', closedWeekdays: [0] }],
    communicationConversations: [{ id: CONV, communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp', phone: PHONE,
      remoteConversationId: `${PHONE}@s.whatsapp.net`, aiDisposition: 'ai_active', ownershipVersion: 2, customerInputVersion: 1, recentMessages: [{ id: 'M1' }] }],
    whatsappMessages: [originalMessage('M1', QUOTE, 1)],
    customerAgentInboundQueue: [{ id: 'Q1', conversationId: CONV, communicationAccountId: ACCOUNT, messageId: 'M1', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 1 }],
    clients: [{ id: 'C1', name: 'Controlled customer', phone: PHONE, whatsapp: PHONE, active: true }],
    properties: [{ id: 'P1', clientId: 'C1', address: 'Wayaca 217', operationalZone: 'Oranjestad Este', active: true }],
    appointments: [
      { id: 'CANCEL1', status: 'cancelled', cancelledAtIso: '2026-09-07T10:00:00.000Z', ...option, startTime: '09:30', capacityLockIds: locks.map(lock => lock.id), workOrderIds: ['WO-CANCEL'] },
      { id: 'APT1', customerId: 'C1', propertyId: 'P1', status: 'confirmed', date: '2026-09-10', startTime: '09:30', endTime: '10:30', workLines: WORK, workOrderIds: ['WO-ORIGINAL'], assignments: [a] },
    ],
    bookingCapacityLocks: locks.map(lock => ({ ...lock, active: false, appointmentId: 'CANCEL1' })),
    workOrders: [
      { id: 'WO-CANCEL', appointmentId: 'CANCEL1', status: 'Cancelada', date: '2026-09-08', time: '09:30', vanId: 'VAN-1', scheduledSlots: 1 },
      { id: 'WO-ORIGINAL', appointmentId: 'APT1', clientId: 'C1', propertyId: 'P1', status: 'Confirmada', date: '2026-09-10', time: '09:30', vanId: 'VAN-1', scheduledSlots: 1, appointmentDurationMinutes: 60 },
    ],
    services: [{ id: 's1', name: 'Servicio estándar', itemType: 'Servicio', active: true, featured: true, durationMinutes: 60,
      serviceDefinition: { version: 1, bookingCode: 'standard_service', duration: { minutes: 60 } } }],
    vans: [{ id: 'VAN-1', name: 'Van 1', active: true, responsibleStaffId: 'driver-1' }],
    staffProfiles: [{ id: 'driver-1', active: true, availability: 'Disponible', canDriveVan: true }],
    dailyVanAssignments: [], staffAbsences: [], calendarClosures: [], vanHalfDaySchedules: [],
  });
}
function append(db, id, text, version, direction = 'inbound') {
  db.patch('whatsappMessages', id, originalMessage(id, text, version, direction));
  const conversation = db.read('communicationConversations', CONV);
  db.patch('communicationConversations', CONV, { recentMessages: [...conversation.recentMessages, { id }],
    ...(direction === 'inbound' ? { customerInputVersion: version } : {}) });
  if (direction === 'inbound') db.patch('customerAgentInboundQueue', `Q${version}`, { conversationId: CONV,
    communicationAccountId: ACCOUNT, messageId: id, expectedOwnershipVersion: 2, expectedCustomerInputVersion: version });
}
function modelDecision(caseId = '', extra = {}) {
  return { caseId, kind: 'earlier_appointment', propertyId: 'P1', appointmentId: 'APT1', state: 'waiting',
    evidenceMessageId: 'M1', quote: QUOTE, confidence: 0.98, ambiguous: false, dateFrom: '', dateTo: '', ...extra };
}
const registerArgs = { action: 'register', kind: 'earlier_appointment', customerId: 'C1', propertyId: 'P1', appointmentId: 'APT1', sourceQuote: QUOTE, dateFrom: '', dateTo: '' };
function recovery(db, analyze, clock = () => NOW) {
  return createCustomerInterestRecovery({ db, analyze, clock, apiKeyProvider: () => 'synthetic-test-key' });
}
async function fixture() {
  const db = database();
  const recorded = await createCustomerBookingInterestTools({ db, clock: () => NOW }).record(registerArgs, { conversationId: CONV, inboundMessageId: 'M1' });
  append(db, 'M2', 'Thanks.', 2);
  return { db, caseId: recorded.caseId };
}
async function reconcile(db, caseId) {
  return recovery(db, async () => [modelDecision(caseId)]).recover({ conversationId: CONV, inboundMessageId: 'M2' });
}
async function inspect(db) {
  const before = JSON.stringify([...db.docs]);
  const writes = db.writes.length;
  const result = await createMayaRecoveryMatching({ db, clock: () => NOW }).inspect({ cancelledAppointmentId: 'CANCEL1' });
  assert.equal(JSON.stringify([...db.docs]), before); assert.equal(db.writes.length, writes);
  return result.rows[0];
}

test('composition: current request -> thanks -> canonical history reconciliation -> real Tuesday route/capacity fit, with Thursday unchanged', async () => {
  const { db, caseId } = await fixture();
  const original = JSON.stringify(db.read('appointments', 'APT1'));
  assert.equal((await inspect(db)).reason, 'interest_requires_reconfirmation');
  const result = await reconcile(db, caseId);
  assert.equal(result.success, true);
  const row = await inspect(db);
  assert.equal(row.status, 'compatible_for_review', JSON.stringify(row)); assert.equal(row.date, '2026-09-08');
  assert.equal(row.routePolicy, 'enforced'); assert.equal(row.capacityReserved, false); assert.equal(row.proactiveContactAuthorized, false);
  assert.equal(JSON.stringify(db.read('appointments', 'APT1')), original);
});
test('a later Maya outbound acknowledgment does not discard the exact reviewed customer request', async () => {
  const { db, caseId } = await fixture(); await reconcile(db, caseId);
  append(db, 'O3', 'Your preference has been recorded.', 3, 'outbound');
  assert.equal((await inspect(db)).status, 'compatible_for_review');
});
test('Firestore map key ordering cannot invalidate review fingerprints or create another replay write', async () => {
  const { db, caseId } = await fixture(); await reconcile(db, caseId);
  function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseKeys(value[key])]));
    }
    return value;
  }
  assert.equal(digest({ a: 1, b: { x: 2, y: 3 } }), digest({ b: { y: 3, x: 2 }, a: 1 }));
  for (const [key, value] of db.docs) db.docs.set(key, reverseKeys(value));
  assert.equal((await inspect(db)).status, 'compatible_for_review');
  const writes = db.writes.length;
  const replayed = await recovery(db, async () => { assert.fail('replay must not invoke model'); }).recover({ conversationId: CONV, inboundMessageId: 'M2' });
  assert.equal(replayed.replayed, true); assert.equal(db.writes.length, writes);
});
for (const [name, mutate, reason] of [
  ['new inbound', db => append(db, 'M3', 'Actually leave Thursday.', 3), 'interest_requires_reconfirmation'],
  ['edited reviewed thanks', db => db.patch('whatsappMessages', 'M2', { text: 'No, leave Thursday.' }), 'interest_requires_reconfirmation'],
  ['missing reviewed source', db => db.docs.delete('whatsappMessages/M2'), 'interest_requires_reconfirmation'],
  ['operator takeover', db => db.patch('communicationConversations', CONV, { aiDisposition: 'human_active' }), 'pilot_or_ownership_blocked'],
  ['changed original booking', db => db.patch('appointments', 'APT1', { startTime: '15:30' }), 'original_appointment_changed'],
  ['reoccupied capacity', db => db.patch('bookingCapacityLocks', db.read('appointments', 'CANCEL1').capacityLockIds[0], { active: true }), 'capacity_reoccupied_or_unreleased'],
]) test(`a reviewed interest cannot bypass ${name}`, async () => {
  const { db, caseId } = await fixture(); await reconcile(db, caseId); mutate(db);
  const row = await inspect(db); assert.equal(row.reason, reason, JSON.stringify(row)); assert.notEqual(row.status, 'compatible_for_review');
});
test('invalid review cannot fall back to a same-turn legacy authorization', async () => {
  const db = database();
  const result = await recovery(db, async () => [modelDecision()]).recover({ conversationId: CONV, inboundMessageId: 'M1' });
  const caseId = result.results[0].caseId;
  const record = db.read('communicationCases', caseId);
  db.patch('communicationCases', caseId, { interestReview: { ...record.interestReview, windowFingerprint: 'invalid' } });
  assert.equal((await inspect(db)).reason, 'interest_requires_reconfirmation');
});
test('a newer direct waiting preference clears obsolete history proof instead of inheriting it', async () => {
  const { db, caseId } = await fixture(); await reconcile(db, caseId);
  const quote = 'I still want an earlier appointment.'; append(db, 'M3', quote, 3);
  await createCustomerBookingInterestTools({ db, clock: () => NOW }).record({ ...registerArgs, sourceQuote: quote }, { conversationId: CONV, inboundMessageId: 'M3' });
  assert.equal(db.read('communicationCases', caseId).interestReview, null);
  assert.equal((await inspect(db)).status, 'compatible_for_review');
});
test('time passing while the model runs cannot commit interest in an elapsed appointment', async () => {
  const db = database(); let now = new Date('2026-09-07T11:00:00Z');
  db.patch('appointments', 'APT1', { date: '2026-09-07', startTime: '07:01' });
  const result = await recovery(db, async () => { now = new Date('2026-09-07T11:02:00Z'); return [modelDecision()]; }, () => now)
    .invoke('recover_recent_booking_interest', {}, { conversationId: CONV, inboundMessageId: 'M1' });
  assert.equal(result.success, false); assert.equal(result.error.code, 'appointment_changed'); assert.equal(db.writes.length, 0);
});
test('bounded batch keeps two customer prompts, identities and evidence completely separate', async () => {
  const db = database(); const otherConversation = `COMM-${'D'.repeat(40)}`; const otherPhone = '2975600001';
  db.patch('businessSettings', 'customer-agent', { autoReplyAllowlist: [PHONE, otherPhone] });
  db.patch('clients', 'C2', { active: true, name: 'Other synthetic customer', phone: otherPhone, whatsapp: otherPhone });
  db.patch('properties', 'P2', { active: true, clientId: 'C2', address: 'Second controlled property', operationalZone: 'Oranjestad Este' });
  db.patch('appointments', 'APT2', { customerId: 'C2', propertyId: 'P2', status: 'confirmed', date: '2026-09-10', startTime: '11:30' });
  db.patch('communicationConversations', otherConversation, { ...db.read('communicationConversations', CONV), phone: otherPhone,
    remoteConversationId: `${otherPhone}@s.whatsapp.net`, recentMessages: [{ id: 'SECOND-M1' }] });
  const otherQuote = 'Please offer me an earlier date when available.';
  db.patch('whatsappMessages', 'SECOND-M1', { ...originalMessage('SECOND-M1', otherQuote, 1), conversationId: otherConversation, phone: otherPhone, remoteConversationId: `${otherPhone}@s.whatsapp.net` });
  db.patch('customerAgentInboundQueue', 'SECOND-Q1', { conversationId: otherConversation, communicationAccountId: ACCOUNT,
    messageId: 'SECOND-M1', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 1 });
  let calls = 0;
  const result = await recovery(db, async ({ context: visible }) => {
    calls++;
    if (visible.messages[0].id === 'M1') {
      assert.ok(visible.properties.every(property => property.clientId === 'C1'));
      assert.ok(visible.appointments.every(appointment => appointment.customerId === 'C1'));
      assert.ok(!JSON.stringify(visible).includes(otherQuote)); return [modelDecision()];
    }
    assert.ok(visible.properties.every(property => property.clientId === 'C2'));
    assert.ok(visible.appointments.every(appointment => appointment.customerId === 'C2'));
    assert.ok(!JSON.stringify(visible).includes(QUOTE));
    return [modelDecision('', { propertyId: 'P2', appointmentId: 'APT2', evidenceMessageId: 'SECOND-M1', quote: otherQuote })];
  }).recoverMany({ conversationIds: [CONV, otherConversation], apiKey: 'synthetic-test-key' });
  assert.equal(calls, 2); assert.ok(result.results.every(item => item.success === true), JSON.stringify(result));
  assert.notEqual(result.results[0].results[0].caseId, result.results[1].results[0].caseId);
});
test('changing a stored preference after review invalidates material proof', async () => {
  const { db, caseId } = await fixture(); await reconcile(db, caseId);
  const record = db.read('communicationCases', caseId);
  db.patch('communicationCases', caseId, { bookingInterest: { ...record.bookingInterest, dateTo: '2026-09-09' } });
  assert.equal((await inspect(db)).reason, 'interest_requires_reconfirmation');
});
