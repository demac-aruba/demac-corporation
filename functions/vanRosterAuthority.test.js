'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
const { createVanRosterAuthority } = require('./vanRosterAuthority');
const { crewForDate } = require('./vanRosterHistory');
const { resolveCrewMembership } = require('./bookingSchedulingPrimitives');
const { fieldAssignmentForIdentity } = require('./fieldOperationsAuthorityCore');
const { customerVisibleChanges } = require('./appointmentNotificationService');
const { sameDayScheduleChangeRequired } = require('./technicianScheduleChangeService');

const { seed } = require('./test-support/vanRosterFixture');
function setup(data = seed()) {
  const db = new TransactionalFirestore(data);
  const authority = createVanRosterAuthority({ db, clock: () => new Date('2026-10-26T17:00:00Z') });
  const call = (action, data, uid = 'operator') => authority.execute({ action, data, uid });
  return { db, call };
}
async function request(call) {
  const roster = await call('get_van_roster');
  const rows = roster.rows.map(row => ({ ...row }));
  [rows[0].regularHelperId, rows[1].regularHelperId] = [rows[1].regularHelperId, rows[0].regularHelperId];
  return { expectedToken: roster.token, effectiveDate: roster.effectiveDate, requestId: 'synthetic-swap-001', rows };
}
test('atomic exchange synchronizes canonical roster, profiles, jobs, appointments and Project; preserves real-history surfaces', async () => {
  const { db, call } = setup(), before = new Map(db.store), req = await request(call);
  const result = await call('save_van_roster', req);
  assert.equal(result.changedVans, 2); assert.equal(result.updatedWorkOrders, 1);
  assert.equal(db.read('vans/legacy-101').regularHelperId, 'helper-b');
  assert.equal(db.read('vans/legacy-101').unknownField, 'retain');
  assert.equal(db.read('vans/VAN-2').regularHelperId, 'helper-a');
  assert.equal(db.read('staffProfiles/helper-a').primaryVanId, 'VAN-2');
  assert.deepEqual(db.read('users/login-helper-a'), { ...before.get('users/login-helper-a'), vanId: 'VAN-2', updatedAt: '2026-10-26T17:00:00.000Z' });
  assert.deepEqual(db.read('workOrders/pending').technicianIds, ['tech-a', 'helper-b']);
  assert.deepEqual(db.read('appointments/appointment').assignments[0].technicianIds, ['tech-a', 'helper-b']);
  assert.equal(db.read('appointments/appointment').chargeVersion, 7);
  assert.deepEqual(db.read('projectRecords/project').assignments[0].technicianIds, ['tech-a', 'helper-b']);
  assert.equal(db.read('projectRecords/project').serverVersion, 3);
  for (const path of ['workOrders/completed', 'workOrders/historical', 'employeeTimesheets/helper-a_2026-10-19', 'employeePayrollSettings/helper-a', 'whatsappMessagesQueue/old', 'vanHalfDaySchedules/a', 'vanHalfDaySchedules/b']) assert.deepEqual(db.read(path), before.get(path), path);
  const events = [...db.store].filter(([path]) => path.startsWith('businessSettings/van-roster/events/'));
  assert.equal(events.length, 1); assert.equal(events[0][1].actor.id, 'operator');
  assert.equal(crewForDate(db.read('vans/legacy-101'), '2026-10-25').regularHelperId, 'helper-a');
  assert.equal(crewForDate(db.read('vans/legacy-101'), '2026-10-26').regularHelperId, 'helper-b');
  assert.deepEqual(customerVisibleChanges(before.get('workOrders/pending'), db.read('workOrders/pending')), []);
  assert.equal(sameDayScheduleChangeRequired(before.get('workOrders/pending'), db.read('workOrders/pending'), { date: '2026-10-26', time: '13:00' }), true);
  const memberships = [{ ...db.read('vans/legacy-101'), id: 'VAN-1' }, { ...db.read('vans/VAN-2'), id: 'VAN-2' }].map(van => resolveCrewMembership(van, '2026-10-26', []));
  const context = { memberships, dailyAssignments: [], vanAliases: new Map(), vans: [] };
  assert.equal(fieldAssignmentForIdentity({ staffId: 'helper-a', uid: 'login-helper-a', vanId: 'VAN-2' }, { ...db.read('workOrders/pending'), vanId: 'VAN-1' }, '2026-10-26', context).assigned, false);
  assert.equal(fieldAssignmentForIdentity({ staffId: 'helper-b', uid: 'login-helper-b', vanId: 'VAN-1' }, { ...db.read('workOrders/pending'), vanId: 'VAN-1' }, '2026-10-26', context).assigned, true);
});
test('lost-response retry is exact, idempotent and freshly authorized', async () => {
  const { db, call } = setup(), req = await request(call);
  await call('save_van_roster', req); const after = new Map(db.store);
  assert.equal((await call('save_van_roster', req)).replayed, true); assert.deepEqual(db.store, after);
  await assert.rejects(call('save_van_roster', { ...req, rows: req.rows.slice(1) }), { code: 'roster_replay' });
  db.write('users/operator', { active: false, role: 'office' });
  await assert.rejects(call('save_van_roster', req), { code: 'permission_denied' });
});
test('two operators cannot overwrite one another; transaction retries keep one complete winner', async () => {
  const { db, call } = setup(), req = await request(call);
  const results = await Promise.allSettled([call('save_van_roster', req), call('save_van_roster', { ...req, requestId: 'different-request' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'roster_conflict');
  assert.ok(db.retries > 0);
});
for (const [label, mutate, code] of [
  ['duplicate member', req => { req.rows[1].regularHelperId = req.rows[0].regularHelperId; }, 'roster_duplicate'],
  ['incomplete available van', req => { req.rows[0].regularHelperId = ''; }, 'roster_incomplete'],
  ['unknown helper', req => { req.rows[0].regularHelperId = 'missing'; }, 'roster_staff'],
  ['unqualified driver', req => { req.rows[0].responsibleStaffId = 'spare'; }, 'roster_driver'],
  ['missing van', req => { req.rows.pop(); }, 'roster_input'],
  ['different business day', req => { req.effectiveDate = '2026-10-25'; }, 'roster_date'],
]) test(label + ' rejects everything without a partial move', async () => {
  const { db, call } = setup(), req = await request(call), before = new Map(db.store); mutate(req);
  await assert.rejects(call('save_van_roster', req), { code }); assert.deepEqual(db.store, before);
});
for (const [label, path, value, code] of [
  ['already started', 'workOrders/pending', { ...seed()['workOrders/pending'], status: 'En proceso' }, 'roster_work_started'],
  ['actual minutes on a pending work order', 'workOrders/pending', { ...seed()['workOrders/pending'], actualWorkedMinutes: 12 }, 'roster_work_started'],
  ['execution on appointment only', 'appointments/appointment', { ...seed()['appointments/appointment'], actualStartedAt: '2026-10-26T15:00:00Z' }, 'roster_work_started'],
  ['visit linked only to appointment', 'workVisits/appointment-visit', { appointmentId: 'appointment' }, 'roster_work_started'],
  ['missing appointment lane', 'appointments/appointment', { ...seed()['appointments/appointment'], assignments: [] }, 'roster_link'],
  ['different appointment date', 'appointments/appointment', { ...seed()['appointments/appointment'], date: '2026-10-27' }, 'roster_link'],
  ['missing Project work link', 'projectRecords/project', { ...seed()['projectRecords/project'], assignments: [] }, 'roster_link'],
  ['recorded Field visit', 'workVisits/visit-pending', { workOrderId: 'pending', status: 'not_started' }, 'roster_work_started'],
  ['project actuals', 'projectRecords/project', { ...seed()['projectRecords/project'], assignments: [{ ...seed()['projectRecords/project'].assignments[0], actualHours: 1 }] }, 'roster_work_started'],
  ['daily override collision', 'dailyVanAssignments/override', { date: '2026-10-28', vanId: 'VAN-1', helperStaffId: 'helper-a' }, 'roster_daily'],
  ['staff absent for future job', 'staffAbsences/absence', { staffId: 'helper-b', active: true, fromDate: '2026-10-26', toDate: '2026-10-26' }, 'roster_unavailable'],
]) test(label + ' preserves the entire fleet and linked work', async () => {
  const { db, call } = setup({ ...seed(), [path]: value }), req = await request(call), before = new Map(db.store);
  await assert.rejects(call('save_van_roster', req), { code }); assert.deepEqual(db.store, before);
});
for (const role of ['technician', 'accounting', 'inventory', 'unknown']) test(role + ' cannot read or change roster planning', async () => {
  const { db, call } = setup(); db.write('users/operator', { active: true, role });
  await assert.rejects(call('get_van_roster'), { code: 'permission_denied' });
  await assert.rejects(call('save_van_roster', {}), { code: 'permission_denied' });
});
test('profile changes after opening the editor invalidate its observed fleet', async () => {
  const { db, call } = setup(), req = await request(call);
  db.write('vans/legacy-101', { ...db.read('vans/legacy-101'), status: 'Mantenimiento' });
  const before = new Map(db.store);
  await assert.rejects(call('save_van_roster', req), { code: 'roster_conflict' }); assert.deepEqual(db.store, before);
});
test('repeated transfers at the same instant preserve prior dates and select the last crew for today', async () => {
  const { db, call } = setup();
  await call('save_van_roster', await request(call));
  await call('save_van_roster', { ...await request(call), requestId: 'second-transfer' });
  const van = db.read('vans/legacy-101');
  assert.equal(van.crewHistory.length, 3);
  assert.equal(crewForDate(van, '2026-10-19').regularHelperId, 'helper-a');
  assert.equal(crewForDate(van, '2026-10-26').regularHelperId, 'helper-a');
  assert.deepEqual(db.read('workOrders/pending').technicianIds, ['tech-a', 'helper-a']);
});
test('retired weekly rules and a legacy van reference preserve the canonical transfer links', async () => {
  const data = seed();
  data['vanHalfDaySchedules/retired'] = { vanId: 'VAN-1', active: false, weekday: 4 };
  data['workOrders/pending'].van = 'legacy-101'; delete data['workOrders/pending'].vanId;
  const { db, call } = setup(data);
  await call('save_van_roster', await request(call));
  assert.deepEqual(db.read('workOrders/pending').technicianIds, ['tech-a', 'helper-b']);
  assert.equal(db.read('vanHalfDaySchedules/retired').active, false);
});
test('responsible technicians, helpers and an optional third member move in the same commit', async () => {
  const { db, call } = setup(), req = await request(call);
  [req.rows[0].responsibleStaffId, req.rows[1].responsibleStaffId] = [req.rows[1].responsibleStaffId, req.rows[0].responsibleStaffId];
  req.rows[0].additionalHelperId = 'spare';
  await call('save_van_roster', req);
  assert.deepEqual(db.read('workOrders/pending').technicianIds, ['tech-b', 'helper-b', 'spare']);
  assert.equal(db.read('users/login-tech-b').vanId, 'VAN-1');
  assert.equal(db.read('staffProfiles/tech-a').primaryVanId, 'VAN-2');
});
module.exports = { seed, setup, request };
