'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createVanScheduleCommunicationAuthority } = require('./vanScheduleCommunicationAuthority');
const date = '2098-12-22';
const clock = () => new Date('2098-12-20T11:00:00Z');
function fixture(number = 5) {
  const lane = `VAN-${number}`, source = `legacy-${number}`;
  const seed = {
    [`vans/${source}`]: { name: `Van ${number}`, active: true, status: 'Trabajo liviano', responsibleStaffId: 'driver', crewRevision: 'synthetic-roster' },
    'staffProfiles/driver': { active: true, canDriveVan: true, availability: 'Disponible' },
    'clients/c1': { name: 'Synthetic customer' },
    'properties/p1': { clientId: 'c1', address: 'Synthetic property', operationalZone: 'Oranjestad' },
    'services/s1': { name: 'Servicio estándar', durationMinutes: 60 },
    'businessSettings/appointment-work-presets': { presets: [{ id: 'standard_service', label: 'Servicio estándar', durationMinutesPerUnit: 60, active: true }] },
  };
  const db = new TransactionalFirestore(seed);
  const provider = createSchedulingProvider({ db });
  const authority = createBookingAuthority({ db, availabilityProvider: provider, clock, serverTimestamp: () => clock().toISOString() });
  const request = { customerId: 'c1', propertyId: 'p1', workLines: [{ id: 'w1', presetId: 'standard_service', serviceId: 's1', quantity: 1 }], constraints: { requestedDate: date, requestedTime: '08:30' } };
  const context = { channel: 'office', requiredPrimaryVanId: lane };
  let serial = 0;
  const prepare = () => authority.checkAvailability({ request, context: { ...context, requestKey: `synthetic-prepare-${++serial}` } });
  const commit = (offer, suffix = 'one') => authority.createAppointment({ offerId: offer.offer.id, offerVersion: offer.offer.version, optionId: offer.options[0].id, idempotencyKey: `synthetic-dynamic-booking-${suffix}`, actor: { source: 'office-scheduling', id: 'operator' }, context });
  return { db, provider, authority, lane, source, request, context, prepare, commit };
}
for (const number of [5, 6, 12]) test(`VAN-${number}: canonical discovery, real booking/locks and exact retry`, async () => {
  const f = fixture(number), before = await f.prepare();
  assert.equal(before.available, true);
  assert.equal(before.options[0].assignments[0].vanId, f.lane);
  const first = await f.commit(before), replay = await f.commit(before);
  assert.equal(replay.replayed, true);
  assert.equal(replay.appointmentId, first.appointmentId);
  assert.equal(f.db.read(`workOrders/${first.workOrderIds[0]}`).vanId, f.lane);
  const locks = [...f.db.store].filter(([path]) => path.startsWith('bookingCapacityLocks/')).map(([,value]) => value);
  assert.ok(locks.length > 0);
  assert.ok(locks.every(lock => lock.vanId === f.lane && lock.appointmentId === first.appointmentId));
  const next = await f.prepare();
  assert.ok(!next.options.some(option => option.date === date && option.time === '08:30' && option.assignments.some(a => a.vanId === f.lane)));
});
test('concurrent offers for a new lane cannot double-book', async () => {
  const f = fixture(), a = await f.prepare(), b = await f.prepare();
  const outcomes = await Promise.allSettled([f.commit(a, 'a'), f.commit(b, 'b')]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal([...f.db.store.keys()].filter(path => path.startsWith('appointments/') && path.split('/').length === 2).length, 1);
});
for (const patch of [{ status: 'Fuera de servicio' }, { status: 'Mantenimiento' }, { status: 'Sin personal' }, { active: false }]) test(`activation changes invalidate prepared capacity: ${JSON.stringify(patch)}`, async () => {
  const f = fixture(), offer = await f.prepare();
  f.db.write(`vans/${f.source}`, { ...f.db.read(`vans/${f.source}`), ...patch });
  const result = await f.provider.validateTransaction({ transaction: { get: ref => ref.get() }, db: f.db, request: f.request, option: offer.options[0], appointmentId: 'new' });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'van-unavailable');
  await assert.rejects(f.commit(offer));
  assert.equal([...f.db.store.keys()].filter(path => path.startsWith('appointments/') && path.split('/').length === 2).length, 0);
});
test('deactivation racing the commit retries and rejects without writing a booking', async () => {
  const f = fixture(), offer = await f.prepare();
  const original = f.provider.validateTransaction;
  let changed = false;
  f.provider.validateTransaction = async args => {
    const result = await original(args);
    if (!changed) {
      changed = true;
      f.db.write(`vans/${f.source}`, { ...f.db.read(`vans/${f.source}`), status: 'Fuera de servicio' });
    }
    return result;
  };
  await assert.rejects(f.commit(offer));
  assert.ok(f.db.retries > 0, 'The transaction must retry after a concurrent catalog change.');
  assert.equal([...f.db.store.keys()].filter(path => path.startsWith('appointments/') && path.split('/').length === 2).length, 0);
});
test('inactive legacy crew without revision is rejected inside the transaction', async () => {
  const f = fixture(), offer = await f.prepare();
  f.db.write(`vans/${f.source}`, { ...f.db.read(`vans/${f.source}`), crewRevision: '', status: 'Fuera de servicio' });
  assert.equal((await f.provider.validateTransaction({ transaction: { get: ref => ref.get() }, db: f.db, request: f.request, option: offer.options[0], appointmentId: 'new' })).available, false);
});
test('new lanes retain half-day, absence and unknown-lane validation', async () => {
  const f = fixture(12);
  f.db.write('vanHalfDaySchedules/partial', { active: true, vanId: f.source, weekday: new Date(date+'T12:00:00Z').getUTCDay(), workdayStart: '08:00', workdayEnd: '13:00', extraMorningSlot: '11:30' });
  const check = context => f.provider.checkAvailability({ request: { ...f.request, constraints: { requestedDate: date, requestedTime: '13:30' } }, context, now: clock() });
  assert.ok(!(await check(f.context)).options.some(option => option.date === date && option.time === '13:30'));
  f.db.write('staffAbsences/absence', { staffId: 'driver', active: true, fromDate: date, toDate: date });
  assert.ok(!(await f.prepare()).options.some(option => option.date === date));
  assert.equal((await check({ ...f.context, requiredPrimaryVanId: 'VAN-99' })).options.length, 0);
});
test('WhatsApp settings use the registered new lane and never invent a recipient', async () => {
  const f = fixture(12);
  const api = createVanScheduleCommunicationAuthority({ db: f.db, scheduleService: {}, operatingCalendar: {} });
  assert.equal((await api.getConfiguration()).groups[0].configured, false);
  await api.saveConfiguration({ groups: [{ vanId: f.lane, groupName: 'Synthetic group', groupJid: '120363000000000012@g.us', enabled: true }] }, { uid: 'operator' });
  assert.equal(f.db.read(`vans/${f.source}`).whatsappScheduleGroupJid, '120363000000000012@g.us');
  await assert.rejects(api.saveConfiguration({ groups: [{ vanId: 'VAN-99', groupJid: '120363000000000099@g.us', enabled: true }] }));
  assert.equal([...f.db.store.keys()].some(path => path.startsWith('whatsappOutboundQueue/')), false);
});
