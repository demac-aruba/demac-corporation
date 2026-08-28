import assert from 'node:assert/strict';
import type { CanonicalStaffProfile, CanonicalVan, CanonicalVanHalfDaySchedule } from '../lib/canonical-operations';
import type { EmployeePayrollSettings } from '../lib/employee-attendance';
import { buildEmployeeScheduleChanges, defaultEmployeeWeeklySchedule, type EmployeePayrollScheduleSettings } from '../lib/employee-schedule-settings';
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

const wednesdayAfternoonOff = schedule({
  profile: secretary,
  date: '2026-08-26',
  payrollSettings: {
    id: 'legacy-payroll-yerika',
    sourceStaffId: secretary.id,
    weeklyHalfDayWeekday: 3,
    halfDayEffectiveFrom: '2026-08-01',
    halfDayWorkedHours: 4,
    halfDayPaidFreeHours: 4,
    halfDayOffPeriod: 'afternoon',
  },
});
assert.deepEqual(
  {
    start: wednesdayAfternoonOff.startTime,
    end: wednesdayAfternoonOff.endTime,
    worked: wednesdayAfternoonOff.scheduledMinutes,
    paidFree: wednesdayAfternoonOff.paidFreeMinutes,
  },
  { start: '08:00', end: '12:00', worked: 240, paidFree: 240 },
  'Legacy office half-day records must remain backward compatible.',
);

const wednesdayMorningOff = schedule({
  profile: secretary,
  date: '2026-08-26',
  payrollSettings: {
    id: secretary.id,
    weeklyHalfDayWeekday: 3,
    halfDayEffectiveFrom: '2026-08-01',
    halfDayWorkedHours: 4,
    halfDayPaidFreeHours: 4,
    halfDayOffPeriod: 'morning',
  },
});
assert.deepEqual(
  {
    start: wednesdayMorningOff.startTime,
    end: wednesdayMorningOff.endTime,
    worked: wednesdayMorningOff.scheduledMinutes,
    paidFree: wednesdayMorningOff.paidFreeMinutes,
  },
  { start: '13:00', end: '17:00', worked: 240, paidFree: 240 },
  'Office morning-off half-day must work 13:00–17:00 on the company shift.',
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
  'A custom 09:00–18:00 office shift with a one-hour break must resolve to eight scheduled work hours.',
);

const customWednesday = schedule({ profile: secretary, date: '2026-08-26', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: customWednesday.startTime, end: customWednesday.endTime, worked: customWednesday.scheduledMinutes, paidFree: customWednesday.paidFreeMinutes },
  { start: '09:00', end: '13:00', worked: 240, paidFree: 240 },
  'The office 4h worked + 4h paid-free rule must apply to the employee’s selected custom shift.',
);

const beforeCustomEffective = schedule({
  profile: secretary,
  date: '2026-07-28',
  payrollSettings: { ...customNineToSix, weeklyHalfDayWeekday: null },
});
assert.deepEqual(
  { start: beforeCustomEffective.startTime, end: beforeCustomEffective.endTime, worked: beforeCustomEffective.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'Before the custom schedule effective date, the company schedule must remain in force.',
);

const afterCustomUntil = schedule({
  profile: secretary,
  date: '2026-09-08',
  payrollSettings: { ...customNineToSix, scheduleEffectiveUntil: '2026-08-31' },
});
assert.deepEqual(
  { start: afterCustomUntil.startTime, end: afterCustomUntil.endTime, worked: afterCustomUntil.scheduledMinutes, paidFree: afterCustomUntil.paidFreeMinutes },
  { start: '08:00', end: '17:00', worked: 480, paidFree: 0 },
  'After a bounded custom schedule expires, company schedule must resume and the bounded half-day rule must stop.',
);

const saturday = schedule({ profile: secretary, date: '2026-08-22' });
assert.deepEqual(
  { start: saturday.startTime, end: saturday.endTime, worked: saturday.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'Saturday must use the normal company day, not the obsolete 09:00–13:00 rule.',
);

const sundayWithCustomSettings = schedule({ profile: secretary, date: '2026-08-23', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: sundayWithCustomSettings.startTime, end: sundayWithCustomSettings.endTime, worked: sundayWithCustomSettings.scheduledMinutes },
  { start: '', end: '', worked: 0 },
  'Sunday is globally closed and cannot be overridden by an individual custom schedule.',
);

const employeeWithStartDate = {
  ...secretary,
  employmentStartedAt: '2026-08-11',
} as CanonicalStaffProfile & { employmentStartedAt: string };
const beforeEmployment = schedule({ profile: employeeWithStartDate, date: '2026-08-10', payrollSettings: customNineToSix });
assert.deepEqual(
  { start: beforeEmployment.startTime, end: beforeEmployment.endTime, worked: beforeEmployment.scheduledMinutes, paidFree: beforeEmployment.paidFreeMinutes },
  { start: '', end: '', worked: 0, paidFree: 0 },
  'Calendar, attendance and payroll must not synthesize scheduled work before the employee start date.',
);
const firstEmploymentDay = schedule({ profile: employeeWithStartDate, date: '2026-08-11', payrollSettings: customNineToSix });
assert.equal(firstEmploymentDay.scheduledMinutes, 480, 'Employment start date is inclusive.');

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

const technicalTuesday = schedule({
  profile: technician,
  date: '2026-08-25',
  vans: [van],
  halfDaySchedules: [vanHalfDay],
  payrollSettings: customNineToSix,
});
assert.deepEqual(
  { start: technicalTuesday.startTime, end: technicalTuesday.endTime, worked: technicalTuesday.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'An employee-level custom payroll schedule must never override a technician’s company/Van schedule.',
);

const technicalWednesday = schedule({
  profile: technician,
  date: '2026-08-26',
  vans: [van],
  halfDaySchedules: [vanHalfDay],
  payrollSettings: customNineToSix,
});
assert.deepEqual(
  {
    start: technicalWednesday.startTime,
    end: technicalWednesday.endTime,
    worked: technicalWednesday.scheduledMinutes,
    paidFree: technicalWednesday.paidFreeMinutes,
  },
  { start: '08:00', end: '13:00', worked: 300, paidFree: 180 },
  'Technicians must inherit 5h worked + 3h paid free only from the Van/team half-day rule.',
);

const existingWithUnrelatedFields = {
  id: 'legacy-record',
  sourceStaffId: secretary.id,
  createdAt: '2025-01-01T00:00:00.000Z',
  weekdayHours: 7.5,
  saturdayHours: 6,
} satisfies EmployeePayrollSettings;
const changes = buildEmployeeScheduleChanges({
  employee: secretary,
  existing: existingWithUnrelatedFields,
  mode: 'custom',
  templateId: 'late-9-6',
  weeklySchedule: defaultEmployeeWeeklySchedule('09:00', '18:00', 60),
  effectiveFrom: '2026-08-01',
  halfDayWeekday: 4,
  halfDayOffPeriod: 'afternoon',
  now: '2026-08-27T12:00:00.000Z',
});
assert.equal(changes.createdAt, existingWithUnrelatedFields.createdAt, 'Schedule updates must preserve the original payroll settings creation timestamp.');
assert.equal(changes.weekdayHours, 7.5, 'Legacy payroll hour metadata must be preserved during additive schedule updates.');
assert.equal(changes.saturdayHours, 6, 'Legacy Saturday metadata must be preserved during additive schedule updates.');

const legacyBaselineRecord: EmployeePayrollSettings = {
  id: 'legacy-baseline-record',
  sourceStaffId: secretary.id,
  weeklyHalfDayWeekday: 2,
  halfDayEffectiveFrom: '2026-01-01',
  halfDayWorkedHours: 4,
  halfDayPaidFreeHours: 4,
  halfDayOffPeriod: 'afternoon',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const versionedChanges = buildEmployeeScheduleChanges({
  employee: secretary,
  existing: legacyBaselineRecord,
  mode: 'custom',
  templateId: 'late-9-6',
  weeklySchedule: defaultEmployeeWeeklySchedule('09:00', '18:00', 60),
  effectiveFrom: '2026-09-01',
  halfDayWeekday: 4,
  halfDayOffPeriod: 'afternoon',
  now: '2026-08-27T12:00:00.000Z',
});
assert.equal(versionedChanges.scheduleVersions.length, 2, 'The first V2 save must retain a legacy schedule as a historical baseline instead of overwriting it.');
const legacyVersion = versionedChanges.scheduleVersions.find((version) => version.id.startsWith('legacy-baseline-'));
assert.equal(legacyVersion?.halfDayWeekday, 2, 'Legacy half-day configuration must remain historically recoverable after a V2 save.');
const projectedBeforeNewVersion = schedule({
  profile: secretary,
  date: '2026-08-25',
  payrollSettings: { id: legacyBaselineRecord.id, ...versionedChanges },
});
assert.deepEqual(
  { start: projectedBeforeNewVersion.startTime, end: projectedBeforeNewVersion.endTime, worked: projectedBeforeNewVersion.scheduledMinutes, paidFree: projectedBeforeNewVersion.paidFreeMinutes },
  { start: '08:00', end: '12:00', worked: 240, paidFree: 240 },
  'Historical dates must continue to resolve the preserved legacy schedule after a later schedule version is saved.',
);
const projectedAfterNewVersion = schedule({
  profile: secretary,
  date: '2026-09-03',
  payrollSettings: { id: legacyBaselineRecord.id, ...versionedChanges },
});
assert.deepEqual(
  { start: projectedAfterNewVersion.startTime, end: projectedAfterNewVersion.endTime, worked: projectedAfterNewVersion.scheduledMinutes, paidFree: projectedAfterNewVersion.paidFreeMinutes },
  { start: '09:00', end: '13:00', worked: 240, paidFree: 240 },
  'The newest applicable schedule version must win without destroying the prior historical version.',
);

assert.throws(() => buildEmployeeScheduleChanges({
  employee: technician,
  mode: 'custom',
  templateId: 'office-8-5',
  weeklySchedule: defaultEmployeeWeeklySchedule(),
  effectiveFrom: '2026-08-01',
  halfDayWeekday: 3,
}), /Van\/team/, 'The protected write path must reject individual recurring technician schedules.');

console.log('Employee schedule acceptance passed: backward-compatible office schedules, start-date bounds, custom 8–5/9–6 shifts, protected Sunday, and Van-owned technician half-days.');
