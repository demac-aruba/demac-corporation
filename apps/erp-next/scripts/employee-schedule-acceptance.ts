import assert from 'node:assert/strict';
import type { CanonicalStaffProfile, CanonicalVan, CanonicalVanHalfDaySchedule } from '../lib/canonical-operations';
import type { EmployeePayrollSettings } from '../lib/employee-attendance';
import {
  buildEmployeeScheduleChanges,
  defaultEmployeeWeeklySchedule,
  type EmployeePayrollScheduleSettings,
} from '../lib/employee-schedule-settings';
import { resolveEmployeeSchedule } from '../lib/employee-work-schedule';

function schedule(input: {
  profile: CanonicalStaffProfile;
  date: string;
  payrollSettings?: EmployeePayrollSettings;
  vans?: CanonicalVan[];
  halfDaySchedules?: CanonicalVanHalfDaySchedule[];
}) {
  return resolveEmployeeSchedule({
    profile: input.profile,
    date: input.date,
    payrollSettings: input.payrollSettings,
    vans: input.vans ?? [],
    halfDaySchedules: input.halfDaySchedules ?? [],
  });
}

const secretary: CanonicalStaffProfile = {
  id: 'staff-yerika',
  name: 'Yerika Zapata',
  employeeType: 'Secretaria',
  role: 'Secretaria',
  active: true,
  availability: 'Disponible',
};

const legacyHalfDay: EmployeePayrollSettings = {
  id: 'legacy-payroll-yerika',
  sourceStaffId: secretary.id,
  weeklyHalfDayWeekday: 3,
  halfDayEffectiveFrom: '2026-08-01',
  halfDayWorkedHours: 4,
  halfDayPaidFreeHours: 4,
  halfDayOffPeriod: 'afternoon',
};
const legacyWednesday = schedule({ profile: secretary, date: '2026-08-26', payrollSettings: legacyHalfDay });
assert.deepEqual(
  { start: legacyWednesday.startTime, end: legacyWednesday.endTime, worked: legacyWednesday.scheduledMinutes, paidFree: legacyWednesday.paidFreeMinutes },
  { start: '08:00', end: '12:00', worked: 240, paidFree: 240 },
  'Legacy office half-day records must remain backward compatible.',
);

const customNineToSix: EmployeePayrollScheduleSettings = {
  id: secretary.id,
  sourceStaffId: secretary.id,
  scheduleMode: 'custom',
  scheduleTemplateId: 'late-9-6',
  weeklySchedule: defaultEmployeeWeeklySchedule('09:00', '18:00', 60),
  scheduleEffectiveFrom: '2026-08-01',
  weeklyHalfDayWeekday: 3,
  halfDayEffectiveFrom: '2026-08-01',
  halfDayWorkedHours: 4,
  halfDayPaidFreeHours: 4,
  halfDayOffPeriod: 'afternoon',
};

const customTuesday = schedule({ profile: secretary, date: '2026-08-25', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: customTuesday.startTime, end: customTuesday.endTime, worked: customTuesday.scheduledMinutes, paidFree: customTuesday.paidFreeMinutes },
  { start: '09:00', end: '18:00', worked: 480, paidFree: 0 },
  'A custom 09:00–18:00 shift with a one-hour break must resolve to eight work hours.',
);

const customWednesday = schedule({ profile: secretary, date: '2026-08-26', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: customWednesday.startTime, end: customWednesday.endTime, worked: customWednesday.scheduledMinutes, paidFree: customWednesday.paidFreeMinutes },
  { start: '09:00', end: '13:00', worked: 240, paidFree: 240 },
  'The office 4h worked + 4h paid-free rule must apply to the selected custom shift.',
);

const beforeEffective = schedule({ profile: secretary, date: '2026-07-28', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: beforeEffective.startTime, end: beforeEffective.endTime, worked: beforeEffective.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'Before the custom schedule effective date, the company schedule must remain in force.',
);

const boundedCustom: EmployeePayrollScheduleSettings = { ...customNineToSix, scheduleEffectiveUntil: '2026-08-31' };
const afterEffectiveUntil = schedule({ profile: secretary, date: '2026-09-08', payrollSettings: boundedCustom });
assert.deepEqual(
  { start: afterEffectiveUntil.startTime, end: afterEffectiveUntil.endTime, worked: afterEffectiveUntil.scheduledMinutes, paidFree: afterEffectiveUntil.paidFreeMinutes },
  { start: '08:00', end: '17:00', worked: 480, paidFree: 0 },
  'After a bounded custom schedule expires, the company schedule must resume.',
);

const sunday = schedule({ profile: secretary, date: '2026-08-23', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: sunday.startTime, end: sunday.endTime, worked: sunday.scheduledMinutes },
  { start: '', end: '', worked: 0 },
  'Sunday is globally closed and cannot be overridden by an employee schedule.',
);

const employeeWithStartDate = {
  ...secretary,
  employmentStartedAt: '2026-08-11',
} as CanonicalStaffProfile & { employmentStartedAt: string };
const beforeEmployment = schedule({ profile: employeeWithStartDate, date: '2026-08-10', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: beforeEmployment.startTime, end: beforeEmployment.endTime, worked: beforeEmployment.scheduledMinutes, paidFree: beforeEmployment.paidFreeMinutes },
  { start: '', end: '', worked: 0, paidFree: 0 },
  'No scheduled work may be synthesized before employmentStartedAt.',
);
const firstEmploymentDay = schedule({ profile: employeeWithStartDate, date: '2026-08-11', payrollSettings: customNineToSix });
assert.equal(firstEmploymentDay.scheduledMinutes, 480, 'Employment start date must be inclusive.');

const technician: CanonicalStaffProfile = {
  id: 'staff-tech',
  name: 'Field Technician',
  employeeType: 'Técnico',
  role: 'Técnico responsable',
  canDriveVan: true,
  active: true,
  availability: 'Disponible',
};
const van: CanonicalVan = {
  id: 'VAN-1',
  name: 'Van 1',
  responsibleStaffId: technician.id,
  active: true,
};
const vanHalfDay: CanonicalVanHalfDaySchedule = {
  id: 'half-day-VAN-1',
  vanId: 'VAN-1',
  weekday: 3,
  workdayStart: '08:00',
  workdayEnd: '13:00',
  active: true,
};
const technicalTuesday = schedule({ profile: technician, date: '2026-08-25', vans: [van], halfDaySchedules: [vanHalfDay], payrollSettings: customNineToSix });
assert.deepEqual(
  { start: technicalTuesday.startTime, end: technicalTuesday.endTime, worked: technicalTuesday.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'Employee-level payroll schedule must never override a technician base schedule.',
);
const technicalWednesday = schedule({ profile: technician, date: '2026-08-26', vans: [van], halfDaySchedules: [vanHalfDay], payrollSettings: customNineToSix });
assert.deepEqual(
  { start: technicalWednesday.startTime, end: technicalWednesday.endTime, worked: technicalWednesday.scheduledMinutes, paidFree: technicalWednesday.paidFreeMinutes },
  { start: '08:00', end: '13:00', worked: 300, paidFree: 180 },
  'Technicians must inherit 5h worked + 3h paid free from the Van/team rule.',
);

const legacyRecord: EmployeePayrollSettings = {
  id: 'legacy-baseline-record',
  sourceStaffId: secretary.id,
  weekdayHours: 7.5,
  saturdayHours: 6,
  weeklyHalfDayWeekday: 2,
  halfDayEffectiveFrom: '2026-01-01',
  halfDayWorkedHours: 4,
  halfDayPaidFreeHours: 4,
  halfDayOffPeriod: 'afternoon',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const changes = buildEmployeeScheduleChanges({
  employee: secretary,
  existing: legacyRecord,
  mode: 'custom',
  templateId: 'late-9-6',
  weeklySchedule: defaultEmployeeWeeklySchedule('09:00', '18:00', 60),
  effectiveFrom: '2026-09-01',
  halfDayWeekday: 4,
  halfDayOffPeriod: 'afternoon',
  now: '2026-08-27T12:00:00.000Z',
});
assert.equal(changes.createdAt, legacyRecord.createdAt, 'Original payroll settings creation timestamp must be preserved.');
assert.equal(changes.weekdayHours, 7.5, 'Legacy payroll metadata must be preserved by additive schedule writes.');
assert.equal(changes.saturdayHours, 6, 'Legacy Saturday metadata must be preserved by additive schedule writes.');
assert.equal(changes.scheduleVersions.length, 2, 'First V2 save must retain a legacy historical baseline.');

const versionedSettings: EmployeePayrollScheduleSettings = { id: legacyRecord.id, ...changes };
const historicalTuesday = schedule({ profile: secretary, date: '2026-08-25', payrollSettings: versionedSettings });
assert.deepEqual(
  { start: historicalTuesday.startTime, end: historicalTuesday.endTime, worked: historicalTuesday.scheduledMinutes, paidFree: historicalTuesday.paidFreeMinutes },
  { start: '08:00', end: '12:00', worked: 240, paidFree: 240 },
  'Historical dates must continue to use the preserved legacy schedule after a future version is saved.',
);
const futureThursday = schedule({ profile: secretary, date: '2026-09-03', payrollSettings: versionedSettings });
assert.deepEqual(
  { start: futureThursday.startTime, end: futureThursday.endTime, worked: futureThursday.scheduledMinutes, paidFree: futureThursday.paidFreeMinutes },
  { start: '09:00', end: '13:00', worked: 240, paidFree: 240 },
  'Newest applicable schedule version must apply without destroying the historical baseline.',
);

assert.throws(() => buildEmployeeScheduleChanges({
  employee: technician,
  mode: 'custom',
  templateId: 'office-8-5',
  weeklySchedule: defaultEmployeeWeeklySchedule(),
  effectiveFrom: '2026-08-01',
  halfDayWeekday: 3,
}), /Van\/team/, 'Protected write path must reject individual technician recurring schedules.');

console.log('Employee schedule acceptance passed: legacy compatibility, effective 8–5/9–6 schedules, employment bounds, protected Sunday, historical versioning, and Van-owned technician half-days.');
