'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { createCustomerBookingInterestTools } = require('./demacCustomerBookingInterest');
const { createSchedulingProvider, buildCapacityLocks } = require('./bookingAuthoritySchedulingProvider');
const { createMayaRecoveryMatching, snapshotReader, recoveryTarget } = require('./mayaRecoveryMatching');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');

const NOW = new Date('2026-09-07T11:00:00.000Z'); // Monday 07:00 Aruba
const TARGET_DATE = '2026-09-08';
const ACCOUNT = 'demac-wa-corporate';
const PHONE = '2975600000';
const CONV = `COMM-${'C'.repeat(40)}`;
const QUOTE = 'Can you come earlier?';
const CTX = { conversationId: CONV, inboundMessageId: 'MSG-1' };
const WORK = [{ id: 'work-1', presetId: 'standard_service', serviceId: 's1', quantity: 1 }];
const service = { id: 's1', name: 'Servicio estándar', itemType: 'Servicio', active: true, featured: true,
  durationMinutes: 60, serviceDefinition: { version: 1, bookingCode: 'standard_service', duration: { minutes: 60 } } };
function assignment(time = '09:30', slots = 1) {
  return { vanId: 'VAN-1', vanName: 'Van 1', role: 'primary', time,
    endTime: `${String(Number(time.slice(0, 2)) + slots).padStart(2, '0')}:30`,
    slots, quantity: slots, durationMinutes: slots * 60, technicianIds: ['driver-1'] };
}
function seed() {
  const a = assignment();
  const cancelledOption = { date: TARGET_DATE, time: '09:30', endTime: '10:30', assignments: [a] };
  const locks = buildCapacityLocks(cancelledOption);
  const comms = { communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp', phone: PHONE,
    remoteConversationId: `${PHONE}@s.whatsapp.net` };
  return {
    businessSettings: [
      { id: 'whatsapp', communicationAccountId: ACCOUNT },
      { id: 'customer-agent', enabled: true, autoReplyEnabled: true, replyMode: 'allowlist', autoReplyAllowlist: [PHONE], bookingInterestEnabled: true },
      { id: 'business-calendar', closedWeekdays: [0] },
    ],
    communicationConversations: [{ id: CONV, ...comms, aiDisposition: 'ai_active', ownershipVersion: 2, customerInputVersion: 4 }],
    whatsappMessages: [{ id: 'MSG-1', ...comms, conversationId: CONV, direction: 'inbound', text: QUOTE, customerInputVersion: 4 }],
    customerAgentInboundQueue: [{ id: 'Q-1', communicationAccountId: ACCOUNT, conversationId: CONV,
      messageId: 'MSG-1', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 4 }],
    clients: [{ id: 'C-1', name: 'Controlled customer', active: true, phone: PHONE, whatsapp: PHONE }],
    properties: [{ id: 'P-1', clientId: 'C-1', active: true, address: 'Wayaca 217', operationalZone: 'Oranjestad Este' }],
    appointments: [
      { id: 'CANCEL-1', status: 'cancelled', cancelledAtIso: '2026-09-07T10:00:00.000Z', ...cancelledOption,
        startTime: '09:30', capacityLockIds: locks.map(lock => lock.id), workOrderIds: ['WO-CANCEL'] },
      { id: 'APT-1', customerId: 'C-1', propertyId: 'P-1', status: 'confirmed', date: '2026-09-10', startTime: '09:30',
        endTime: '10:30', workLines: WORK, workOrderIds: ['WO-ORIGINAL'], assignments: [a] },
    ],
    bookingCapacityLocks: locks.map(lock => ({ ...lock, active: false, appointmentId: 'CANCEL-1' })),
    workOrders: [
      { id: 'WO-CANCEL', appointmentId: 'CANCEL-1', status: 'Cancelada', date: TARGET_DATE, time: '09:30', vanId: 'VAN-1', scheduledSlots: 1 },
      { id: 'WO-ORIGINAL', appointmentId: 'APT-1', clientId: 'C-1', propertyId: 'P-1', status: 'Confirmada',
        date: '2026-09-10', time: '09:30', vanId: 'VAN-1', scheduledSlots: 1, appointmentDurationMinutes: 60 },
    ],
    services: [service],
    vans: [{ id: 'VAN-1', name: 'Van 1', active: true, responsibleStaffId: 'driver-1' }],
    staffProfiles: [{ id: 'driver-1', active: true, availability: 'Disponible', canDriveVan: true }],
    dailyVanAssignments: [], staffAbsences: [], calendarClosures: [], vanHalfDaySchedules: [],
  };
}
async function fixture(overrides = {}) {
  const db = new MemoryDb(seed());
  const args = { action: 'register', kind: 'earlier_appointment', customerId: 'C-1', propertyId: 'P-1',
    appointmentId: 'APT-1', sourceQuote: QUOTE, dateFrom: '', dateTo: '', ...overrides };
  const result = await createCustomerBookingInterestTools({ db, clock: () => NOW }).record(args, CTX);
  assert.equal(result.success, true);
  db.writes.length = 0;
  return { db, caseId: result.caseId };
}
async function inspect(db, extra = {}, providerFactory) {
  const before = JSON.stringify([...db.docs]);
  const result = await createMayaRecoveryMatching({ db, clock: () => NOW, ...(providerFactory ? { providerFactory } : {}) })
    .inspect({ cancelledAppointmentId: 'CANCEL-1', ...extra });
  assert.equal(JSON.stringify([...db.docs]), before, 'read-only matching cannot mutate domain or workflow records');
  assert.equal(db.writes.length, 0);
  assert.equal(result.capacityReserved, false);
  assert.equal(result.proactiveContactAuthorized, false);
  return result;
}

test('Thursday interest matches the Tuesday cancellation through the real provider without moving the Thursday booking', async () => {
  const { db } = await fixture();
  const calls = [];
  const result = await inspect(db, {}, options => {
    const provider = createSchedulingProvider(options);
    const check = provider.checkAvailability.bind(provider);
    provider.checkAvailability = args => { calls.push(args); return check(args); };
    return provider;
  });
  assert.equal(result.rows[0].status, 'compatible_for_review', JSON.stringify(result));
  assert.equal(result.rows[0].date, TARGET_DATE);
  assert.equal(result.rows[0].time, '09:30');
  assert.equal(result.rows[0].routePolicy, 'enforced');
  assert.equal(result.rows[0].customerConfirmationRequired, true);
  assert.equal(db.read('appointments', 'APT-1').date, '2026-09-10');
  assert.equal(calls[0].context.channel, 'whatsapp');
  assert.equal(calls[0].context.excludeAppointmentId, 'APT-1');
  assert.equal(calls[0].context.requiredPrimaryVanId, 'VAN-1');
  assert.equal(result.requiresFreshBookingOffer, true);
  assert.equal(result.rankingPolicyApplied, false);
  assert.equal('offerId' in result.rows[0], false);
});

test('a reoccupied work-order slot is not offered as free', async () => {
  const { db } = await fixture();
  db.patch('workOrders', 'NEW-BOOKING', { appointmentId: 'NEW-APT', date: TARGET_DATE, time: '09:30', vanId: 'VAN-1',
    status: 'Confirmada', scheduledSlots: 1, appointmentDurationMinutes: 60 });
  const result = await inspect(db);
  assert.equal(result.rows[0].status, 'incompatible');
});

test('an active capacity lock blocks matching even if work-order projection is still absent', async () => {
  const { db } = await fixture();
  const lockId = db.read('appointments', 'CANCEL-1').capacityLockIds[0];
  db.patch('bookingCapacityLocks', lockId, { active: true, appointmentId: 'OTHER-APT' });
  const result = await inspect(db);
  assert.equal(result.rows[0].reason, 'capacity_reoccupied_or_unreleased');
});

test('all original work lines must fit; a larger job cannot occupy a one-hour cancellation', async () => {
  const { db } = await fixture();
  db.patch('appointments', 'APT-1', { workLines: [{ ...WORK[0], quantity: 3 }] });
  assert.equal((await inspect(db)).rows[0].status, 'incompatible');
});

test('missing canonical workload is never replaced by a guessed service', async () => {
  const { db } = await fixture(); db.patch('appointments', 'APT-1', { workLines: [] });
  assert.equal((await inspect(db)).rows[0].reason, 'original_workload_invalid');
});

test('unbooked waiters remain reviewable until service and quantity are captured', async () => {
  const { db } = await fixture({ kind: 'new_appointment', appointmentId: '' });
  const result = await inspect(db);
  assert.equal(result.rows[0].status, 'needs_work_details');
  assert.equal(result.rows[0].reason, 'unbooked_workload_not_recorded');
});

for (const [label, collection, id, patch, reason] of [
  ['newer customer input', 'communicationConversations', CONV, { customerInputVersion: 5 }, 'interest_requires_reconfirmation'],
  ['operator takeover', 'communicationConversations', CONV, { ownerUserId: 'OP-1', aiDisposition: 'human_active' }, 'pilot_or_ownership_blocked'],
  ['operator return with changed version', 'communicationConversations', CONV, { ownershipVersion: 4 }, 'interest_requires_reconfirmation'],
  ['removed pilot phone', 'businessSettings', 'customer-agent', { autoReplyAllowlist: [] }, 'pilot_or_ownership_blocked'],
  ['disabled Maya', 'businessSettings', 'customer-agent', { enabled: false }, 'pilot_or_ownership_blocked'],
  ['changed source quote', 'whatsappMessages', 'MSG-1', { text: 'No thanks, keep Thursday.' }, 'interest_evidence_missing'],
  ['foreign property', 'properties', 'P-1', { clientId: 'OTHER' }, 'property_or_sector_requires_review'],
  ['missing sector', 'properties', 'P-1', { operationalZone: '', zone: '' }, 'property_or_sector_requires_review'],
  ['changed original date', 'appointments', 'APT-1', { date: '2026-09-11' }, 'original_appointment_changed'],
  ['original already cancelled', 'appointments', 'APT-1', { status: 'cancelled' }, 'original_appointment_changed'],
  ['original awaiting change', 'appointments', 'APT-1', { dispatchHold: { active: true } }, 'original_appointment_changed'],
  ['work already started', 'workOrders', 'WO-ORIGINAL', { status: 'En progreso' }, 'original_work_changed'],
  ['foreign original work', 'workOrders', 'WO-ORIGINAL', { appointmentId: 'OTHER' }, 'original_work_changed'],
]) {
  test(`${label} cannot be treated as an eligible earlier-booking request`, async () => {
    const { db } = await fixture(); db.patch(collection, id, patch);
    assert.equal((await inspect(db)).rows[0].reason, reason);
  });
}

test('withdrawn and expired preferences are excluded without deleting their evidence', async () => {
  const withdrawn = await fixture(); withdrawn.db.patch('communicationCases', withdrawn.caseId, { state: 'WITHDRAWN' });
  assert.equal((await inspect(withdrawn.db)).rows[0].reason, 'interest_not_waiting');
  const expired = await fixture();
  expired.db.patch('communicationCases', expired.caseId, { bookingInterest: { ...expired.db.read('communicationCases', expired.caseId).bookingInterest, dateTo: '2026-09-06' } });
  assert.equal((await inspect(expired.db)).rows[0].reason, 'interest_expired');
});

test('a customer asking for Wednesday is not matched to Tuesday', async () => {
  const { db } = await fixture({ dateFrom: '2026-09-09' });
  assert.equal((await inspect(db)).rows[0].reason, 'outside_requested_dates');
});

test('a cancelled slot later than the original booking cannot be an adelanto', async () => {
  const { db } = await fixture();
  db.patch('appointments', 'CANCEL-1', { date: '2026-09-12' });
  assert.equal((await inspect(db)).rows[0].reason, 'target_not_earlier');
});

test('a missing driver or inactive Van is rejected by the real scheduling engine', async () => {
  for (const [collection, id, patch] of [['staffProfiles', 'driver-1', { canDriveVan: false }], ['vans', 'VAN-1', { active: false }]]) {
    const { db } = await fixture(); db.patch(collection, id, patch);
    assert.equal((await inspect(db)).rows[0].status, 'incompatible');
  }
});

test('dispatch hold, missing cancellation provenance, elapsed or malformed source never reaches candidate scanning', async () => {
  for (const patch of [{ status: 'confirmed', dispatchHold: { active: true } }, { cancelledAtIso: '' },
    { date: '2026-09-06' }, { startTime: 'bad' }, { endTime: '' }, { capacityLockIds: [] }]) {
    const { db } = await fixture(); db.patch('appointments', 'CANCEL-1', patch);
    await assert.rejects(() => inspect(db)); assert.equal(db.writes.length, 0);
  }
});

test('client-supplied slot and routing overrides are rejected', async () => {
  const { db } = await fixture();
  for (const data of [{ pageSize: 11 }, { pageSize: 0 }, { pageSize: '10' }, { channel: 'office' }, { requestedTime: '15:30' }, { routePolicy: 'advisory' }]) {
    await assert.rejects(() => inspect(db, data));
  }
});

test('only the active account is scanned, with bounded pages and scoped cursors', async () => {
  const { db, caseId } = await fixture();
  db.patch('communicationCases', 'FOREIGN', { ...db.read('communicationCases', caseId), communicationAccountId: 'OTHER' });
  db.patch('communicationCases', 'ZZZ', { ...db.read('communicationCases', caseId), state: 'WITHDRAWN' });
  const first = await inspect(db, { pageSize: 1 });
  assert.equal(first.rows.length, 1); assert.equal(first.nextCursor, caseId);
  const second = await inspect(db, { pageSize: 1, afterId: first.nextCursor });
  assert.equal(second.rows[0].caseId, 'ZZZ'); assert.equal(second.nextCursor, null);
  await assert.rejects(() => inspect(db, { afterId: 'FOREIGN' }), error => error.code === 'invalid_cursor');
  const scans = db.queries.filter(query => query.collectionName === 'communicationCases');
  assert.ok(scans.every(query => query.max <= 11));
});

test('snapshot reader memoizes canonical queries and exposes no write methods', async () => {
  const db = new MemoryDb(seed());
  await db.runTransaction(async transaction => {
    const reader = snapshotReader(db, transaction);
    assert.equal(reader.runTransaction, undefined);
    const query = reader.collection('services');
    assert.equal(query.set, undefined); assert.equal(query.delete, undefined); assert.equal(query.doc('s1').update, undefined);
    await Promise.all([query.get(), reader.collection('services').get()]);
    assert.equal(db.queries.filter(item => item.collectionName === 'services').length, 1);
  });
});

test('read transaction is explicitly non-writing and a persistence/provider failure is not an empty successful result', async () => {
  const { db } = await fixture();
  const run = db.runTransaction.bind(db);
  db.runTransaction = (callback, options) => { assert.equal(options.readOnly, true); return run(callback); };
  await inspect(db);
  db.failCommit = true;
  await assert.rejects(() => inspect(db), /Simulated/);
  assert.equal(db.writes.length, 0);
});

for (const role of [null, 'technician']) {
  test(`recovery matching office action rejects ${role || 'missing authentication'} before reading candidates`, async () => {
    const db = new MemoryDb(seed());
    if (role) db.patch('users', 'USER', { active: true, role });
    const api = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => ({ uid: 'USER', role }) });
    const result = await api.handle({ method: 'POST', headers: role ? { authorization: 'Bearer test' } : {},
      body: { action: 'inspect_maya_recovery_candidates', data: { cancelledAppointmentId: 'CANCEL-1' } } });
    assert.equal(result.status, role ? 403 : 401); assert.equal(db.queries.length, 0); assert.equal(db.writes.length, 0);
  });
}
