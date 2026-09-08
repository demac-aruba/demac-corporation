'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { bookingInterestCaseId } = require('./demacCustomerBookingInterest');
const { createSchedulingProvider, buildCapacityLocks } = require('./bookingAuthoritySchedulingProvider');
const { snapshotReader, createMayaRecoveryMatching } = require('./mayaRecoveryMatching');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const NOW = new Date('2026-09-07T11:00:00Z');
const ACCOUNT = 'test-corporate';
const PHONE = '2975600000';
const CONV = `COMM-${'D'.repeat(40)}`;
const WORK = [{ id: 'w1', presetId: 'standard_service', serviceId: 's1', quantity: 1 }];
function setup({ date = '2026-09-08', time = '09:30', originalDate = '2026-09-17' } = {}) {
  const option = { date, time, endTime: `${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}:30`,
    assignments: [{ vanId: 'VAN-1', role: 'primary', time, slots: 1, quantity: 1, durationMinutes: 60 }] };
  const locks = buildCapacityLocks(option);
  const record = { caseType: 'booking_interest', state: 'WAITING', customerId: 'c1', propertyId: 'p1', appointmentId: 'a1',
    communicationAccountId: ACCOUNT, conversationId: CONV, lastSourceMessageId: 'm1',
    bookingInterest: { kind: 'earlier_appointment', sourceQuote: 'Please come earlier.', originalDate, originalTime: '09:30', dateFrom: '', dateTo: '' },
    interestHistory: [{ action: 'register', messageId: 'm1', customerInputVersion: 1, ownershipVersion: 1 }] };
  const caseId = bookingInterestCaseId({ customerId: 'c1', propertyId: 'p1', kind: 'earlier_appointment', appointmentId: 'a1' }, ACCOUNT, CONV);
  const comm = { communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp', phone: PHONE, remoteConversationId: `${PHONE}@s.whatsapp.net` };
  const db = new MemoryDb({
    businessSettings: [
      { id: 'whatsapp', communicationAccountId: ACCOUNT },
      { id: 'customer-agent', enabled: true, autoReplyEnabled: true, autoReplyAllowlist: [PHONE], replyMode: 'allowlist' },
      { id: 'business-calendar', closedWeekdays: [0] },
    ],
    communicationCases: [{ id: caseId, ...record }],
    communicationConversations: [{ id: CONV, ...comm, ownershipVersion: 1, customerInputVersion: 1, aiDisposition: 'ai_active' }],
    whatsappMessages: [{ id: 'm1', ...comm, direction: 'inbound', conversationId: CONV, customerInputVersion: 1, text: 'Please come earlier.' }],
    appointments: [
      { id: 'cancel1', ...option, startTime: time, status: 'cancelled', cancelledAtIso: '2026-09-07T10:00:00Z', capacityLockIds: locks.map(item => item.id) },
      { id: 'a1', customerId: 'c1', propertyId: 'p1', status: 'confirmed', date: originalDate, startTime: '09:30', workLines: WORK, workOrderIds: ['wo1'] },
    ],
    bookingCapacityLocks: locks.map(item => ({ ...item, active: false, appointmentId: 'cancel1' })),
    clients: [{ id: 'c1', name: 'Controlled test customer', phone: PHONE, active: true }],
    properties: [{ id: 'p1', clientId: 'c1', address: 'Controlled address', operationalZone: 'Oranjestad Este', active: true }],
    workOrders: [{ id: 'wo1', appointmentId: 'a1', clientId: 'c1', propertyId: 'p1', date: originalDate, time: '09:30', vanId: 'VAN-1', status: 'Confirmada', scheduledSlots: 1 }],
    services: [{ id: 's1', name: 'Servicio estándar', itemType: 'Servicio', active: true, featured: true, durationMinutes: 60,
      serviceDefinition: { version: 1, bookingCode: 'standard_service', duration: { minutes: 60 } } }],
    vans: [{ id: 'VAN-1', name: 'Van 1', active: true, responsibleStaffId: 'driver1' }],
    staffProfiles: [{ id: 'driver1', active: true, canDriveVan: true, availability: 'Disponible' }],
    dailyVanAssignments: [], staffAbsences: [], calendarClosures: [], vanHalfDaySchedules: [],
  });
  return { db, option, caseId };
}
async function inspect(db, providerFactory) {
  return createMayaRecoveryMatching({ db, clock: () => NOW, ...(providerFactory ? { providerFactory } : {}) }).inspect({ cancelledAppointmentId: 'cancel1' });
}

test('review: Maya enforces geographic routing even when the same explicit office placement would be advisory', async () => {
  const { db } = setup();
  db.patch('businessSettings', 'whatsapp-copilot-routing', { officeZoneId: 'office', maximumAnchorDistance: 100,
    zones: [{ id: 'office', label: 'Office', position: 50, aliases: ['office'] }, { id: 'north', label: 'Noord', position: 90, aliases: ['noord'] }] });
  db.patch('properties', 'p1', { operationalZone: 'Noord' });
  db.patch('properties', 'anchor-property', { operationalZone: 'Office' });
  db.patch('workOrders', 'anchor', { appointmentId: 'anchor-appointment', propertyId: 'anchor-property',
    date: '2026-09-08', time: '08:30', vanId: 'VAN-1', status: 'Confirmada', scheduledSlots: 1 });
  const request = { customerId: 'c1', propertyId: 'p1', workLines: WORK, constraints: { requestedDate: '2026-09-08', requestedTime: '09:30' } };
  const office = await createSchedulingProvider({ db }).checkAvailability({ request, now: NOW,
    context: { channel: 'office', requiredPrimaryVanId: 'VAN-1', excludeAppointmentId: 'a1' } });
  assert.equal(office.metadata.routePolicy, 'advisory');
  assert.ok(office.options.length > 0, 'Control: the physical free slot exists for an explicit office placement');
  const maya = await inspect(db);
  assert.equal(maya.rows[0].status, 'incompatible', JSON.stringify(maya));
  assert.equal(db.writes.length, 0);
});

test('review: canonical Sunday closure defeats a physically free cancelled slot', async () => {
  const { db } = setup({ date: '2026-09-13' });
  assert.equal((await inspect(db)).rows[0].status, 'incompatible');
  assert.equal(db.writes.length, 0);
});

test('review: a Van half-day prevents using a cancelled afternoon appointment', async () => {
  const { db } = setup({ time: '13:30' });
  db.patch('vanHalfDaySchedules', 'half', { vanId: 'VAN-1', weekday: 2, active: true });
  assert.equal((await inspect(db)).rows[0].status, 'incompatible');
});

test('review: a provider error is surfaced instead of reporting no waiting candidates', async () => {
  const { db } = setup();
  await assert.rejects(() => inspect(db, () => ({ checkAvailability: async () => { throw new Error('Controlled provider failure'); } })), /Controlled provider failure/);
  assert.equal(db.writes.length, 0);
});

test('review: an option for another date, hour or Van cannot masquerade as the cancelled opening', async () => {
  for (const patch of [{ date: '2026-09-09' }, { time: '10:30' }, { assignments: [{ vanId: 'VAN-OTHER' }] }]) {
    const { db, option } = setup();
    const result = await inspect(db, () => ({ checkAvailability: async () => ({ options: [{ ...option, ...patch }] }),
      validateTransaction: async () => { throw new Error('A wrong target must not reach capacity validation'); } }));
    assert.equal(result.rows[0].status, 'incompatible'); assert.equal(db.writes.length, 0);
  }
});

test('review: forged extra capacity outside the original cancellation is rejected', async () => {
  const { db, option } = setup();
  const result = await inspect(db, () => ({ checkAvailability: async () => ({ options: [option] }),
    validateTransaction: async () => ({ available: true, capacityLocks: [{ id: 'FOREIGN-CAPACITY' }] }) }));
  assert.equal(result.rows[0].reason, 'work_exceeds_cancelled_capacity'); assert.equal(db.writes.length, 0);
});

test('review: capacity validation cannot acquire a write-capable reference or transaction', async () => {
  const { db } = setup();
  const result = await inspect(db, options => {
    const real = createSchedulingProvider(options);
    const validate = real.validateTransaction.bind(real);
    real.validateTransaction = args => {
      assert.equal(args.transaction.set, undefined);
      assert.equal(args.db.collection('appointments').doc('a1').set, undefined);
      return validate(args);
    };
    return real;
  });
  assert.equal(result.rows[0].status, 'compatible_for_review');
});

test('review: authenticated office routing reaches the matcher, while malformed targets remain errors', async () => {
  const { db } = setup(); db.patch('users', 'office', { role: 'admin', active: true });
  const api = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => ({ uid: 'office', role: 'admin' }) });
  const result = await api.handle({ method: 'POST', headers: { authorization: 'Bearer controlled-test' },
    body: { action: 'inspect_maya_recovery_candidates', data: { cancelledAppointmentId: 'missing-cancellation' } } });
  assert.equal(result.body.success, false);
  assert.equal(result.body.error.code, 'not_cancelled');
  assert.equal(db.writes.length, 0);
});

test('review: candidate checks share one scheduling snapshot rather than requerying master data per call', async () => {
  const { db } = setup();
  await db.runTransaction(async transaction => {
    const reader = snapshotReader(db, transaction);
    const provider = createSchedulingProvider({ db: reader });
    const args = { request: { customerId: 'c1', propertyId: 'p1', workLines: WORK, constraints: { requestedDate: '2026-09-08', requestedTime: '09:30' } },
      context: { channel: 'whatsapp', requiredPrimaryVanId: 'VAN-1', excludeAppointmentId: 'a1' }, now: NOW };
    await provider.checkAvailability(args); await provider.checkAvailability(args);
    assert.equal(db.queries.filter(query => query.collectionName === 'staffProfiles').length, 1);
  });
});
