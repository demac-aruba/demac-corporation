import assert from 'node:assert/strict';
import { canonicalCrewReadinessRoster, canonicalVanId, type CanonicalDailyVanAssignment, type CanonicalOperationsState, type CanonicalStaffProfile, type CanonicalVan } from '../lib/canonical-operations';
import { buildVanSaveRecord, nextCanonicalVanId, validateDailyVanAssignment, validateVanCrew, workedMinutes } from '../lib/van-profile';

const driver: CanonicalStaffProfile = { id: 'staff-driver', name: 'Driver', employeeType: 'Técnico', role: 'Técnico responsable', canDriveVan: true, active: true };
const helper: CanonicalStaffProfile = { id: 'staff-helper', name: 'Helper', employeeType: 'Técnico', role: 'Ayudante', canDriveVan: false, active: true };
const third: CanonicalStaffProfile = { id: 'staff-third', name: 'Third Helper', employeeType: 'Técnico', role: 'Ayudante', canDriveVan: false, active: true };
const otherDriver: CanonicalStaffProfile = { id: 'staff-driver-2', name: 'Second Driver', employeeType: 'Técnico', role: 'Técnico', canDriveVan: true, active: true };
const staff = [driver, helper, third, otherDriver];

const historicalVans: CanonicalVan[] = [
  { id: 'VAN-1783801335935', name: 'Van 2', plate: 'A-V2' },
  { id: 'VAN-1783801335936', name: 'Van 4', plate: 'A-25921' },
  { id: 'VAN-1783801335937', name: 'Van 1', plate: 'A-58347' },
  { id: 'VAN-1783801335938', name: 'Van 3', plate: 'A-59742' },
];
assert.equal(canonicalVanId(historicalVans[0].id, historicalVans), 'VAN-2', 'A known legacy Firestore document ID must resolve through the explicit migration registry.');
assert.equal(canonicalVanId('VAN-2', historicalVans), 'VAN-2', 'Direct canonical references must continue to resolve unchanged for WhatsApp and Scheduling lookups.');
assert.equal(canonicalVanId('VAN-5', [...historicalVans, { id: 'VAN-5', name: 'Van 5' }]), 'VAN-5', 'Future canonical Van IDs must remain supported.');
assert.equal(canonicalVanId(historicalVans[0].id, [{ ...historicalVans[0], name: 'West Team' }]), 'VAN-2', 'Renaming a legacy Van display name must not change its explicit identity alias.');
const collisionFleet: CanonicalVan[] = [{ id: 'RESOURCE-ALPHA', name: 'Van 5' }, { id: 'VAN-5', name: 'West Team' }];
assert.deepEqual(collisionFleet.map((van) => canonicalVanId(van.id, collisionFleet)), ['RESOURCE-ALPHA', 'VAN-5'], 'An opaque master-data ID named Van 5 must not collide with the real VAN-5 record.');
const historicalOrder = [...historicalVans]
  .sort((a, b) => canonicalVanId(a.id, historicalVans).localeCompare(canonicalVanId(b.id, historicalVans), undefined, { numeric: true }))
  .map((van) => canonicalVanId(van.id, historicalVans));
assert.deepEqual(historicalOrder, ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4'], 'Legacy physical Vans must sort by canonical lane number, not Firestore document ID.');

const legacyVan: CanonicalVan = {
  id: 'VAN-1', name: 'Van 1', status: 'Disponible', responsibleStaffId: driver.id, regularHelperId: helper.id, technicianIds: [driver.id, helper.id], active: true,
};
assert.equal(validateVanCrew(legacyVan, staff), true, 'Existing two-person Van crew must remain valid without a third helper.');

const threePersonVan: CanonicalVan = { ...legacyVan, additionalHelperId: third.id, notes: 'Preserve me' };
const saved = buildVanSaveRecord(threePersonVan, staff, '2026-08-28T12:00:00.000Z');
assert.deepEqual(saved.technicianIds, [driver.id, helper.id, third.id], 'Canonical technicianIds must mirror all three regular crew slots.');
assert.equal(saved.notes, 'Preserve me', 'Unrelated existing Van profile fields must be preserved by the save builder.');
assert.equal(saved.additionalHelperId, third.id, 'Optional third helper must persist on the canonical Van record.');
const clearedThird = buildVanSaveRecord({ ...threePersonVan, additionalHelperId: undefined }, staff, '2026-08-28T13:00:00.000Z');
assert.equal(clearedThird.additionalHelperId, '', 'Removing an optional third helper must write an explicit empty value so Firestore update masks clear the old assignment.');
assert.deepEqual(clearedThird.technicianIds, [driver.id, helper.id], 'technicianIds must drop a removed third helper.');

assert.throws(() => validateVanCrew({ ...legacyVan, regularHelperId: driver.id }, staff), /same employee/i, 'One person cannot occupy multiple regular crew positions.');
assert.throws(() => validateVanCrew({ ...legacyVan, responsibleStaffId: third.id }, staff), /authorized to drive/i, 'Responsible driver must be explicitly authorized to drive Vans.');
assert.equal(validateVanCrew({ id: 'VAN-5', name: 'Van 5', status: 'Fuera de servicio', active: true }, staff), true, 'A newly created out-of-service Van may be saved before crew is assigned.');
assert.throws(
  () => validateVanCrew({ id: 'VAN-1', name: 'Van 1', status: 'Disponible', active: true }, staff),
  /requires a responsible technician/i,
  'An available protected-fleet Van cannot create booking capacity without a driver.',
);
const futureVan: CanonicalVan = {
  id: 'VAN-FUTURE-TEST-947',
  name: 'Future Test Field Van',
  status: 'Disponible',
  responsibleStaffId: driver.id,
  regularHelperId: helper.id,
  active: true,
};
assert.equal(validateVanCrew(futureVan, staff), true, 'An opaque future Van from master data may become live capacity when its crew is valid.');
assert.equal(buildVanSaveRecord(futureVan, staff, '2026-09-01T12:00:00.000Z').id, futureVan.id, 'Saving a future Van must preserve its opaque canonical ID.');
assert.throws(
  () => validateVanCrew({ ...futureVan, regularHelperId: undefined }, staff),
  /requires a regular helper/i,
  'A future Van must satisfy the same live-capacity crew invariant as every existing Van.',
);

const ids: CanonicalVan[] = [
  { id: 'VAN-1', name: 'Van 99 display rename' }, { id: 'VAN-2', name: 'Van 2' }, { id: 'v3', name: 'Van 3 legacy duplicate' }, { id: 'VAN-4', name: 'Van 4' },
];
assert.equal(nextCanonicalVanId(ids), 'VAN-5', 'Add Van must use the next canonical numeric Van ID.');
const vanTwo: CanonicalVan = { id: 'VAN-2', name: 'Van 2', status: 'Disponible', responsibleStaffId: otherDriver.id, regularHelperId: third.id, active: true };
assert.throws(
  () => validateVanCrew({ ...legacyVan, additionalHelperId: third.id }, staff, [legacyVan, vanTwo]),
  /already part of the regular crew for Van 2/i,
  'A staff member cannot be a regular crew member of two Vans at the same time.',
);

const override: CanonicalDailyVanAssignment = {
  id: 'daily-VAN-1-2026-08-31', date: '2026-08-31', vanId: 'VAN-1', driverStaffId: otherDriver.id, helperStaffId: helper.id, additionalHelperStaffId: third.id,
};
assert.equal(validateDailyVanAssignment(override, staff), true, 'Daily override must support a driver, helper and additional helper without changing the regular crew.');
assert.throws(() => validateDailyVanAssignment({ ...override, additionalHelperStaffId: helper.id }, staff), /same employee/i, 'Daily override cannot duplicate the same person across crew slots.');
assert.throws(() => validateDailyVanAssignment({ ...override, driverStaffId: third.id, additionalHelperStaffId: undefined }, staff), /authorized to drive/i, 'Temporary driver must also be authorized to drive Vans.');
assert.throws(
  () => validateDailyVanAssignment({ id: 'daily-conflict', date: '2026-08-31', vanId: 'VAN-2', driverStaffId: driver.id }, staff, [legacyVan, vanTwo], []),
  /already assigned to Van 1/i,
  'Date-scoped overrides must prevent the same person from resolving onto two Vans simultaneously.',
);
const vanTwoReplacement: CanonicalDailyVanAssignment = { id: 'daily-VAN-2-2026-08-31', date: '2026-08-31', vanId: 'VAN-2', driverStaffId: driver.id, helperStaffId: third.id };
assert.equal(
  validateDailyVanAssignment(vanTwoReplacement, staff, [legacyVan, vanTwo], [{ id: 'daily-VAN-1-2026-08-31', date: '2026-08-31', vanId: 'VAN-1', driverStaffId: otherDriver.id, helperStaffId: helper.id }]),
  true,
  'A staff member may move to another Van for one date only when the original Van also has a dated override removing that person.',
);

const isolatedSourceVan: CanonicalVan = { id: 'VAN-3', name: 'Van 3', status: 'Disponible', responsibleStaffId: otherDriver.id, regularHelperId: third.id, active: true };
const isolatedTargetVan: CanonicalVan = { id: 'VAN-4', name: 'Van 4', status: 'Sin personal', active: true };
assert.equal(
  validateDailyVanAssignment(
    { id: 'daily-after-cancel', date: '2026-09-01', vanId: 'VAN-4', helperStaffId: helper.id },
    staff,
    [isolatedSourceVan, isolatedTargetVan],
    [{ id: 'daily-cancelled', date: '2026-09-01', originalDate: '2026-09-01', vanId: 'VAN-3', helperStaffId: helper.id, status: 'Cancelled' }],
  ),
  true,
  'A cancelled override must preserve its audit record without continuing to reserve that employee on the original date.',
);

const readinessDate = '2026-09-02';
const readinessState: CanonicalOperationsState = {
  staffProfiles: [
    { ...driver, skills: ['Service'], skillsVerified: true, updatedAt: '2026-09-01T12:00:00.000Z' },
    { ...helper, skills: ['Service'], skillsVerified: true, updatedAt: '2026-09-01T12:00:00.000Z' },
    { ...otherDriver, skills: ['Service'], skillsVerified: true, updatedAt: '2026-09-01T12:00:00.000Z' },
  ],
  vans: [{ id: 'RESOURCE-FIELD-ALPHA', name: 'Van 5', active: true, responsibleStaffId: driver.id, regularHelperId: helper.id }],
  dailyVanAssignments: [{ id: 'daily-alpha', date: readinessDate, vanId: 'RESOURCE-FIELD-ALPHA', driverStaffId: otherDriver.id, helperStaffId: helper.id }],
  vanMaintenanceLogs: [],
  staffAbsences: [{ id: 'absence-helper', staffId: helper.id, fromDate: readinessDate, toDate: readinessDate, active: true }],
  vanHalfDaySchedules: [],
  calendarClosures: [],
  businessCalendar: { id: 'business-calendar', closedWeekdays: [0] },
};
const readinessRoster = canonicalCrewReadinessRoster(readinessState, readinessDate);
assert.equal(readinessRoster.some((employee) => employee.id === otherDriver.id && employee.vanId === 'RESOURCE-FIELD-ALPHA' && employee.active), true, 'Dispatch roster must resolve the dated driver override for an opaque Van ID.');
assert.equal(readinessRoster.some((employee) => employee.id === driver.id), false, 'The regular driver must not leak into a date with an explicit replacement.');
assert.equal(readinessRoster.find((employee) => employee.id === helper.id)?.active, false, 'A dated canonical absence must make the resolved helper inactive for readiness.');

assert.equal(workedMinutes('08:00', '13:00'), 300, 'Van partial day 08:00–13:00 must resolve to exactly five worked hours.');
assert.equal(workedMinutes('09:00', '13:00'), 240, 'Van partial day may use exact custom worked hours.');
assert.throws(() => workedMinutes('13:00', '09:00'), /after start time/i, 'Invalid partial-day windows must be rejected.');

console.log('Van profile acceptance passed: explicit legacy Van aliases, opaque/display-rename identity stability, date-aware canonical readiness roster, canonical crew ownership, optional third helper, cross-Van exclusivity, daily overrides, cancelled-override recovery, safe clearing, dynamic future-Van activation, new-Van defaults and exact partial-day hours.');
