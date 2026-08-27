import assert from 'node:assert/strict';
import type { CanonicalStaffProfile, CanonicalVan, CanonicalVanHalfDaySchedule } from '../lib/canonical-operations';
import type { EmployeePayrollSettings } from '../lib/employee-attendance';
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
  'Office afternoon-off half-day must work 08:00–12:00 and remain paid for the other four hours.',
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
  'Office morning-off half-day must work 13:00–17:00.',
);

const legacyPeriodMissing = schedule({
  profile: secretary,
  date: '2026-08-26',
  payrollSettings: {
    id: 'legacy-payroll-yerika',
    weeklyHalfDayWeekday: 3,
    halfDayWorkedHours: 4,
    halfDayPaidFreeHours: 4,
  },
});
assert.equal(legacyPeriodMissing.startTime, '08:00');
assert.equal(legacyPeriodMissing.endTime, '12:00');

const saturday = schedule({ profile: secretary, date: '2026-08-22' });
assert.deepEqual(
  { start: saturday.startTime, end: saturday.endTime, worked: saturday.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'Saturday must use the normal company day, not the obsolete 09:00–13:00 rule.',
);

const sunday = schedule({ profile: secretary, date: '2026-08-23' });
assert.deepEqual(
  { start: sunday.startTime, end: sunday.endTime, worked: sunday.scheduledMinutes },
  { start: '', end: '', worked: 0 },
  'Sunday is the only global weekly company closure.',
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

const technicalWednesday = schedule({
  profile: technician,
  date: '2026-08-26',
  vans: [van],
  halfDaySchedules: [vanHalfDay],
  // An employee payroll half-day must never override a technical Van/team rule.
  payrollSettings: {
    id: technician.id,
    weeklyHalfDayWeekday: 2,
    halfDayWorkedHours: 4,
    halfDayPaidFreeHours: 4,
    halfDayOffPeriod: 'morning',
  },
});
assert.deepEqual(
  {
    start: technicalWednesday.startTime,
    end: technicalWednesday.endTime,
    worked: technicalWednesday.scheduledMinutes,
    paidFree: technicalWednesday.paidFreeMinutes,
  },
  { start: '08:00', end: '13:00', worked: 300, paidFree: 180 },
  'Technicians must inherit their recurring half-day only from the Van/team rule.',
);

console.log('Employee schedule acceptance passed: employment dates, one company calendar, Van half-days for technicians, individual half-days for office staff.');
