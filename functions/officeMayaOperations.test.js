const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryDb } = require('./test-support/mayaWorkspaceMemoryDb');
const { cancellationRange, cancellationRow, createMayaOperationsReadModel, dateKey, documentId, pageSize, waitlistRow } = require('./mayaOperationsReadModel');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const NOW = new Date('2026-09-06T18:00:00Z');
const range = { from: '2026-09-06', to: '2026-09-06' };
const customer = { id: 'C-1', name: 'Controlled test customer' };
const property = { id: 'P-1', clientId: 'C-1', address: 'Controlled property', operationalZone: 'Test sector' };
const appointment = { id: 'APT-1', customerId: 'C-1', propertyId: 'P-1', status: 'cancelled', cancelledAtIso: '2026-09-06T12:00:00.000Z', date: '2026-09-08', startTime: '09:30', cancellationReason: 'Customer requested cancellation' };
function seed() { return { clients: [customer], properties: [property], appointments: [appointment], businessSettings: [{ id: 'whatsapp', communicationAccountId: 'active-account' }] }; }
function reader(db) { return createMayaOperationsReadModel({ db, clock: () => NOW }); }
function interest(overrides = {}) {
  return { id: 'CASE-1', caseType: 'booking_interest', communicationAccountId: 'active-account', state: 'WAITING', customerId: 'C-1', propertyId: 'P-1', appointmentId: 'APT-2',
    bookingInterest: { kind: 'earlier_appointment', originalDate: '2026-09-10', originalTime: '09:30', sourceQuote: 'Can you come earlier?' }, ...overrides };
}
const booked = { id: 'APT-2', customerId: 'C-1', propertyId: 'P-1', status: 'confirmed', date: '2026-09-10', startTime: '09:30' };
test('Aruba day filtering includes the UTC hours after midnight and excludes the next local day', () => {
  const result = cancellationRange(range, NOW);
  assert.equal(result.start, '2026-09-06T04:00:00.000Z');
  assert.equal(result.end, '2026-09-07T04:00:00.000Z');
});
test('invalid dates, unbounded ranges, invalid record IDs and page sizes are rejected', () => {
  assert.equal(dateKey('2026-02-30'), '');
  for (const args of [{ from: 'invalid' }, { from: '2026-09-07', to: '2026-09-06' }, { from: '2026-01-01', to: '2026-09-06' }]) assert.throws(() => cancellationRange(args, NOW));
  for (const id of ['../x', '/', 'a/b', '..']) assert.throws(() => documentId(id));
  for (const value of [0, 51, 2.5, '25']) assert.throws(() => pageSize(value));
});
test('pending dispatch hold is not a cancelled appointment', () => {
  assert.equal(cancellationRow({ ...appointment, status: 'confirmed', dispatchHold: { active: true } }, customer, property), null);
});
test('cancellation projection contains provenance, not a claim that the slot remains free', () => {
  const row = cancellationRow({ ...appointment, lastLifecycleActorName: 'Maya', lastLifecycleSource: 'demac-customer-agent' }, customer, property);
  assert.equal(row.actor, 'Maya'); assert.equal(row.currentAvailabilityVerified, false);
  assert.equal(row.identityVerified, true); assert.equal(row.reason, appointment.cancellationReason);
});
test('foreign property metadata cannot leak into a customer row', () => {
  const row = cancellationRow(appointment, customer, { ...property, clientId: 'OTHER', address: 'Must not be exposed' });
  assert.equal(row.address, ''); assert.equal(row.sector, ''); assert.equal(row.identityVerified, false);
});
test('list reads canonical cancelled appointments without writes, messages or full history scans', async () => {
  const db = new MemoryDb(seed()); const result = await reader(db).listCancellations(range);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].id, appointment.id);
  assert.equal(result.readOnly, true); assert.equal(db.writes.length, 0);
  assert.equal(db.queries[0].max, 26); assert.equal(db.queries[0].collectionName, 'appointments');
  assert.equal(result.coverage, 'canonical_cancelledAtIso');
});
test('pagination handles equal timestamps without duplicate rows', async () => {
  const db = new MemoryDb(seed());
  for (let i = 2; i < 7; i++) db.patch('appointments', `APT-${i}`, { ...appointment });
  const first = await reader(db).listCancellations({ ...range, pageSize: 2 });
  const second = await reader(db).listCancellations({ ...range, pageSize: 2, afterId: first.nextCursor });
  assert.equal(first.rows.length, 2); assert.equal(second.rows.length, 2);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 4);
});
test('only current cancellation status is listed even when an old timestamp remains', async () => {
  const db = new MemoryDb(seed()); db.patch('appointments', 'APT-1', { status: 'confirmed' });
  const result = await reader(db).listCancellations(range); assert.deepEqual(result.rows, []);
});
test('cursor outside date range or missing from canonical records is rejected', async () => {
  const db = new MemoryDb(seed());
  await assert.rejects(() => reader(db).listCancellations({ ...range, afterId: 'MISSING' }));
  db.patch('appointments', 'OLD', { cancelledAtIso: '2026-08-01T12:00:00.000Z' });
  await assert.rejects(() => reader(db).listCancellations({ ...range, afterId: 'OLD' }));
});
test('waiting and withdrawn are preferences, not consent to send or reschedule', () => {
  const row = waitlistRow(interest(), customer, property, booked, '2026-09-06');
  assert.equal(row.state, 'waiting'); assert.equal(row.canContact, false); assert.equal(row.capacityReserved, false);
  assert.equal(waitlistRow(interest({ state: 'WITHDRAWN' }), customer, property, booked, '2026-09-06').state, 'withdrawn');
});
test('changed, cancelled or missing original booking requires review', () => {
  for (const changed of [null, { ...booked, date: '2026-09-09' }, { ...booked, status: 'cancelled' }, { ...booked, customerId: 'OTHER' }]) {
    assert.equal(waitlistRow(interest(), customer, property, changed, '2026-09-06').state, 'needs_review');
  }
});
test('expired waiting deadline is derived without modifying stored requests', () => {
  const record = interest(); record.bookingInterest.dateTo = '2026-09-05';
  assert.equal(waitlistRow(record, customer, property, booked, '2026-09-06').state, 'expired');
  assert.equal(record.state, 'WAITING');
});
test('waiting list is isolated to the configured account and excludes cancellation cases', async () => {
  const db = new MemoryDb(seed()); db.patch('appointments', 'APT-2', booked);
  db.patch('communicationCases', 'CASE-1', interest());
  db.patch('communicationCases', 'FOREIGN', interest({ id: 'FOREIGN', communicationAccountId: 'other-account' }));
  db.patch('communicationCases', 'CANCEL', { caseType: 'appointment_change', communicationAccountId: 'active-account' });
  const result = await reader(db).listWaitlist(); assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 'CASE-1'); assert.equal(db.writes.length, 0);
  await assert.rejects(() => reader(db).listWaitlist({ afterId: 'FOREIGN' }));
});
test('unconfigured account is an error, not an apparently empty healthy waiting list', async () => {
  await assert.rejects(() => reader(new MemoryDb()).listWaitlist(), error => error.code === 'configuration_missing');
});
for (const action of ['list_maya_cancellations', 'list_maya_waitlist']) {
  test(`${action} rejects unauthenticated access before reading business data`, async () => {
    const db = new MemoryDb(seed());
    const api = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => { throw new Error('must not verify without token'); } });
    const result = await api.handle({ method: 'POST', headers: {}, body: { action, data: range } });
    assert.equal(result.status, 401); assert.equal(db.queries.length, 0); assert.equal(db.writes.length, 0);
  });
  test(`${action} denies a technician role`, async () => {
    const db = new MemoryDb(seed()); db.patch('users', 'TECH-1', { active: true, role: 'technician' });
    const api = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => ({ uid: 'TECH-1', role: 'technician' }) });
    const result = await api.handle({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { action, data: range } });
    assert.equal(result.status, 403); assert.equal(db.queries.length, 0); assert.equal(db.writes.length, 0);
  });
  test(`${action} is available through the existing office authorization boundary`, async () => {
    const db = new MemoryDb(seed()); db.patch('users', 'OFFICE-1', { active: true, role: 'admin' });
    const api = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async () => ({ uid: 'OFFICE-1', role: 'admin' }) });
    const result = await api.handle({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { action, data: range } });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.success, true); assert.equal(db.writes.length, 0);
  });
}
