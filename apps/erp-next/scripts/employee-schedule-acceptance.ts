import assert from 'node:assert/strict';
import type { CanonicalStaffProfile, CanonicalVan, CanonicalVanHalfDaySchedule } from '../lib/canonical-operations';
import type { EmployeeSchedulePayrollSettings } from '../lib/employee-schedule-settings';
import { resolveEmployeeSchedule } from '../lib/employee-work-schedule';

function schedule(input: {
  profile: CanonicalStaffProfile;
  date: string;
  payrollSettings?: EmployeeSchedulePayrollSettings;
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

const newlyHiredSecretary = {
  ...secretary,
  id: 'staff-new-hire',
  name: 'New Hire',
  employmentStartedAt: '2026-08-11',
} as CanonicalStaffProfile & { employmentStartedAt: string };
const beforeEmployment = schedule({ profile: newlyHiredSecretary, date: '2026-08-10' });
assert.deepEqual(
  {
    start: beforeEmployment.startTime,
    end: beforeEmployment.endTime,
    worked: beforeEmployment.scheduledMinutes,
    paidFree: beforeEmployment.paidFreeMinutes,
  },
  { start: '', end: '', worked: 0, paidFree: 0 },
  'Dates before employmentStartedAt must never create automatic scheduled or regular attendance.',
);
assert.equal(beforeEmployment.label, 'Employment starts 2026-08-11');

const firstEmploymentDay = schedule({ profile: newlyHiredSecretary, date: '2026-08-11' });
assert.deepEqual(
  { start: firstEmploymentDay.startTime, end: firstEmploymentDay.endTime, worked: firstEmploymentDay.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'The employment start date is inclusive and must use the normal configured schedule.',
);

const legacyOfficeHalfDay = schedule({
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
    start: legacyOfficeHalfDay.startTime,
    end: legacyOfficeHalfDay.endTime,
    worked: legacyOfficeHalfDay.scheduledMinutes,
    paidFree: legacyOfficeHalfDay.paidFreeMinutes,
  },
  { start: '08:00', end: '12:00', worked: 240, paidFree: 240 },
  'Legacy office half-day records must remain compatible after the schedule redesign.',
);

const lateOfficeSettings: EmployeeSchedulePayrollSettings = {
  id: secretary.id,
  sourceStaffId: secretary.id,
  scheduleMode: 'custom',
  workdayStart: '09:00',
  workdayEnd: '18:00',
  breakMinutes: 60,
  scheduleEffectiveFrom: '2026-08-01',
  weeklyHalfDayWeekday: 3,
  halfDayEffectiveFrom: '2026-08-01',
  halfDayOffPeriod: 'afternoon',
  halfDayRule: 'office-4-4',
};

const lateOfficeNormalDay = schedule({
  profile: secretary,
  date: '2026-08-25',
  payrollSettings: lateOfficeSettings,
});
assert.deepEqual(
  {
    start: lateOfficeNormalDay.startTime,
    end: lateOfficeNormalDay.endTime,
    worked: lateOfficeNormalDay.scheduledMinutes,
    paidFree: lateOfficeNormalDay.paidFreeMinutes,
  },
  { start: '09:00', end: '18:00', worked: 480, paidFree: 0 },
  'A custom 09:00–18:00 shift with a one-hour break must resolve to eight paid work hours.',
);

const lateOfficeHalfDay = schedule({
  profile: secretary,
  date: '2026-08-26',
  payrollSettings: lateOfficeSettings,
});
assert.deepEqual(
  {
    start: lateOfficeHalfDay.startTime,
    end: lateOfficeHalfDay.endTime,
    worked: lateOfficeHalfDay.scheduledMinutes,
    paidFree: lateOfficeHalfDay.paidFreeMinutes,
  },
  { start: '09:00', end: '13:00', worked: 240, paidFree: 240 },
  'Office custom partial days must work four hours and credit four paid-free hours.',
);

const companyDefaultWithStaleLegacyFields = schedule({
  profile: secretary,
  date: '2026-08-26',
  payrollSettings: {
    ...lateOfficeSettings,
    scheduleMode: 'company-default',
  },
});
assert.deepEqual(
  {
    start: companyDefaultWithStaleLegacyFields.startTime,
    end: companyDefaultWithStaleLegacyFields.endTime,
    worked: companyDefaultWithStaleLegacyFields.scheduledMinutes,
    paidFree: companyDefaultWithStaleLegacyFields.paidFreeMinutes,
  },
  { start: '08:00', end: '17:00', worked: 480, paidFree: 0 },
  'Selecting company default must neutralize stale employee custom fields without creating a second source of truth.',
);

const futureLateShift = schedule({
  profile: secretary,
  date: '2026-08-25',
  payrollSettings: {
    ...lateOfficeSettings,
    scheduleEffectiveFrom: '2026-09-01',
    halfDayEffectiveFrom: '2026-09-01',
  },
});
assert.deepEqual(
  { start: futureLateShift.startTime, end: futureLateShift.endTime, worked: futureLateShift.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'A future custom schedule must not affect attendance before its effective date.',
);

const sundayWithCustomSchedule = schedule({
  profile: secretary,
  date: '2026-08-23',
  payrollSettings: lateOfficeSettings,
});
assert.deepEqual(
  { start: sundayWithCustomSchedule.startTime, end: sundayWithCustomSchedule.endTime, worked: sundayWithCustomSchedule.scheduledMinutes },
  { start: '', end: '', worked: 0 },
  'Sunday is company-closed and cannot be overridden by an employee custom schedule.',
);

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

const technicalVanFallback = schedule({
  profile: technician,
  date: '2026-08-26',
  vans: [van],
  halfDaySchedules: [vanHalfDay],
});
assert.deepEqual(
  {
    start: technicalVanFallback.startTime,
    end: technicalVanFallback.endTime,
    worked: technicalVanFallback.scheduledMinutes,
    paidFree: technicalVanFallback.paidFreeMinutes,
  },
  { start: '08:00', end: '13:00', worked: 300, paidFree: 180 },
  'Technicians without an employee override must continue inheriting their Van/team partial-day rule.',
);

const technicalCustomOverride = schedule({
  profile: technician,
  date: '2026-08-26',
  vans: [van],
  halfDaySchedules: [vanHalfDay],
  payrollSettings: {
    id: technician.id,
    sourceStaffId: technician.id,
    scheduleMode: 'custom',
    workdayStart: '09:00',
    workdayEnd: '18:00',
    breakMinutes: 60,
    scheduleEffectiveFrom: '2026-08-01',
    weeklyHalfDayWeekday: 3,
    halfDayEffectiveFrom: '2026-08-01',
    halfDayOffPeriod: 'afternoon',
    halfDayRule: 'technician-5-3',
  },
});
assert.deepEqual(
  {
    start: technicalCustomOverride.startTime,
    end: technicalCustomOverride.endTime,
    worked: technicalCustomOverride.scheduledMinutes,
    paidFree: technicalCustomOverride.paidFreeMinutes,
  },
  { start: '09:00', end: '14:00', worked: 300, paidFree: 180 },
  'An explicit technician profile schedule must override the inherited Van/team fallback and apply the 5h + 3h rule.',
);

console.log('Employee schedule acceptance passed: employment dates, Sunday closure, 08–17/09–18 custom shifts, office 4+4, technician 5+3, and Van fallback precedence.');
