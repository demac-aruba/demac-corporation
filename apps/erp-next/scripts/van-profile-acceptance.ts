import assert from 'node:assert/strict';
import type { CanonicalDailyVanAssignment, CanonicalStaffProfile, CanonicalVan } from '../lib/canonical-operations';
import { buildVanSaveRecord, nextCanonicalVanId, validateDailyVanAssignment, validateVanCrew, workedMinutes } from '../lib/van-profile';

const driver: CanonicalStaffProfile = { id: 'staff-driver', name: 'Driver', employeeType: 'Técnico', role: 'Técnico responsable', canDriveVan: true, active: true };
const helper: CanonicalStaffProfile = { id: 'staff-helper', name: 'Helper', employeeType: 'Técnico', role: 'Ayudante', canDriveVan: false, active: true };
const third: CanonicalStaffProfile = { id: 'staff-third', name: 'Third Helper', employeeType: 'Técnico', role: 'Ayudante', canDriveVan: false, active: true };
const otherDriver: CanonicalStaffProfile = { id: 'staff-driver-2', name: 'Second Driver', employeeType: 'Técnico', role: 'Técnico', canDriveVan: true, active: true };
const staff = [driver, helper, third, otherDriver];

const legacyVan: CanonicalVan = {
  id: 'VAN-1', name: 'Van 1', status: 'Disponible', responsibleStaffId: driver.id, regularHelperId: helper.id, technicianIds: [driver.id, helper.id], active: true,
};
assert.equal(validateVanCrew(legacyVan, staff), true, 'Existing two-person Van crew must remain valid without a third helper.');

const threePersonVan: CanonicalVan = { ...legacyVan, additionalHelperId: third.id, notes: 'Preserve me' };
const saved = buildVanSaveRecord(threePersonVan, staff, '2026-08-28T12:00:00.000Z');
assert.deepEqual(saved.technicianIds, [driver.id, helper.id, third.id], 'Canonical technicianIds must mirror all three regular crew slots.');
assert.equal(saved.notes, 'Preserve me', 'Unrelated existing Van profile fields must be preserved by the save builder.');
assert.equal(saved.additionalHelperId, third.id, 'Optional third helper must persist on the canonical Van record.');

assert.throws(() => validateVanCrew({ ...legacyVan, regularHelperId: driver.id }, staff), /same employee/i, 'One person cannot occupy multiple regular crew positions.');
assert.throws(() => validateVanCrew({ ...legacyVan, responsibleStaffId: third.id }, staff), /authorized to drive/i, 'Responsible driver must be explicitly authorized to drive Vans.');
assert.equal(validateVanCrew({ id: 'VAN-5', name: 'Van 5', status: 'Fuera de servicio', active: true }, staff), true, 'A newly created out-of-service Van may be saved before crew is assigned.');
assert.throws(() => validateVanCrew({ id: 'VAN-5', name: 'Van 5', status: 'Disponible', active: true }, staff), /requires a responsible technician/i, 'An available Van cannot create booking capacity without a driver.');

const ids: CanonicalVan[] = [
  { id: 'VAN-1', name: 'Van 1' }, { id: 'VAN-2', name: 'Van 2' }, { id: 'legacy-v3', name: 'Van 3' }, { id: 'VAN-4', name: 'Van 4' },
];
assert.equal(nextCanonicalVanId(ids), 'VAN-5', 'Add Van must use the next canonical numeric Van ID.');

const override: CanonicalDailyVanAssignment = {
  id: 'daily-VAN-1-2026-08-31', date: '2026-08-31', vanId: 'VAN-1', driverStaffId: otherDriver.id, helperStaffId: helper.id, additionalHelperStaffId: third.id,
};
assert.equal(validateDailyVanAssignment(override, staff), true, 'Daily override must support a driver, helper and additional helper without changing the regular crew.');
assert.throws(() => validateDailyVanAssignment({ ...override, additionalHelperStaffId: helper.id }, staff), /same employee/i, 'Daily override cannot duplicate the same person across crew slots.');
assert.throws(() => validateDailyVanAssignment({ ...override, driverStaffId: third.id, additionalHelperStaffId: undefined }, staff), /authorized to drive/i, 'Temporary driver must also be authorized to drive Vans.');

assert.equal(workedMinutes('08:00', '13:00'), 300, 'Van partial day 08:00–13:00 must resolve to exactly five worked hours.');
assert.equal(workedMinutes('09:00', '13:00'), 240, 'Van partial day may use exact custom worked hours.');
assert.throws(() => workedMinutes('13:00', '09:00'), /after start time/i, 'Invalid partial-day windows must be rejected.');

console.log('Van profile acceptance passed: canonical crew ownership, optional third helper, daily overrides, safe new-Van defaults and exact partial-day hours.');
