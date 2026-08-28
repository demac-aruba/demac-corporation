import assert from 'node:assert/strict';
import type { CanonicalOperationsState, CanonicalStaffProfile, CanonicalVan, CanonicalVanHalfDaySchedule } from '../lib/canonical-operations';
import type { EmployeeAttendanceState } from '../lib/employee-attendance';
import {
  buildEmployeeScheduleChanges,
  defaultEmployeeWeeklySchedule,
  type EmployeePayrollScheduleSettings,
} from '../lib/employee-schedule-settings';
import { calculatePayrollDay } from '../lib/employee-payroll';
import { resolveEmployeeSchedule } from '../lib/employee-work-schedule';

const technician: CanonicalStaffProfile = {
  id: 'staff-unassigned-tech',
  name: 'Unassigned Technician',
  employeeType: 'Técnico',
  role: 'Ayudante',
  active: true,
  availability: 'Disponible',
};

const individualChanges = buildEmployeeScheduleChanges({
  employee: technician,
  technicalVanAssigned: false,
  mode: 'custom',
  templateId: 'late-9-6',
  weeklySchedule: defaultEmployeeWeeklySchedule('09:00', '18:00', 60),
  effectiveFrom: '2026-08-01',
  halfDayWeekday: 3,
  halfDayOffPeriod: 'afternoon',
  halfDayStartTime: '09:00',
  halfDayEndTime: '13:00',
  halfDayBreakMinutes: 0,
  now: '2026-08-28T12:00:00.000Z',
});
const individualSettings: EmployeePayrollScheduleSettings = { id: technician.id, ...individualChanges };

const unassignedTuesday = resolveEmployeeSchedule({
  profile: technician,
  date: '2026-08-25',
  payrollSettings: individualSettings,
  vans: [],
  halfDaySchedules: [],
});
assert.deepEqual(
  { start: unassignedTuesday.startTime, end: unassignedTuesday.endTime, worked: unassignedTuesday.scheduledMinutes },
  { start: '09:00', end: '18:00', worked: 480 },
  'A technical employee with no Van must use the saved individual full-day schedule.',
);

const unassignedWednesday = resolveEmployeeSchedule({
  profile: technician,
  date: '2026-08-26',
  payrollSettings: individualSettings,
  vans: [],
  halfDaySchedules: [],
});
assert.deepEqual(
  { start: unassignedWednesday.startTime, end: unassignedWednesday.endTime, worked: unassignedWednesday.scheduledMinutes, paidFree: unassignedWednesday.paidFreeMinutes },
  { start: '09:00', end: '13:00', worked: 240, paidFree: 0 },
  'An unassigned technician must use the exact individual recurring partial-day window with worked hours only.',
);

const van: CanonicalVan = {
  id: 'VAN-2',
  name: 'Van 2',
  responsibleStaffId: technician.id,
  active: true,
};
const vanHalfDay: CanonicalVanHalfDaySchedule = {
  id: 'half-day-VAN-2',
  vanId: 'VAN-2',
  weekday: 4,
  workdayStart: '08:00',
  workdayEnd: '13:00',
  active: true,
};

const assignedWednesday = resolveEmployeeSchedule({
  profile: technician,
  date: '2026-08-26',
  payrollSettings: individualSettings,
  vans: [van],
  halfDaySchedules: [vanHalfDay],
});
assert.deepEqual(
  { start: assignedWednesday.startTime, end: assignedWednesday.endTime, worked: assignedWednesday.scheduledMinutes },
  { start: '08:00', end: '17:00', worked: 480 },
  'Once assigned to a Van, an individual technician partial day must become inactive instead of competing with the Van schedule.',
);

const assignedThursday = resolveEmployeeSchedule({
  profile: technician,
  date: '2026-08-27',
  payrollSettings: individualSettings,
  vans: [van],
  halfDaySchedules: [vanHalfDay],
});
assert.deepEqual(
  { start: assignedThursday.startTime, end: assignedThursday.endTime, worked: assignedThursday.scheduledMinutes, paidFree: assignedThursday.paidFreeMinutes },
  { start: '08:00', end: '13:00', worked: 300, paidFree: 0 },
  'The assigned Van partial-day window must take precedence automatically.',
);

const restoredWednesday = resolveEmployeeSchedule({
  profile: technician,
  date: '2026-08-26',
  payrollSettings: individualSettings,
  vans: [],
  halfDaySchedules: [vanHalfDay],
});
assert.deepEqual(
  { start: restoredWednesday.startTime, end: restoredWednesday.endTime, worked: restoredWednesday.scheduledMinutes },
  { start: '09:00', end: '13:00', worked: 240 },
  'Removing the technician from all Vans must reactivate the preserved individual schedule for applicable dates.',
);

const sunday = resolveEmployeeSchedule({
  profile: technician,
  date: '2026-08-23',
  payrollSettings: individualSettings,
  vans: [],
  halfDaySchedules: [],
});
assert.equal(sunday.scheduledMinutes, 0, 'Sunday remains company-closed even for an unassigned technician individual schedule.');

const operations = {
  staffProfiles: [technician],
  vans: [],
  vanHalfDaySchedules: [],
  staffAbsences: [],
} as unknown as CanonicalOperationsState;
const attendance: EmployeeAttendanceState = {
  payrollSettings: [individualSettings],
  timesheets: [],
  advances: [],
};
const payrollWednesday = calculatePayrollDay({ employee: technician, date: '2026-08-26', operations, attendance });
assert.deepEqual(
  {
    scheduled: payrollWednesday.scheduledWorkHours,
    regular: payrollWednesday.regularHours,
    paidFree: payrollWednesday.paidFreeHours,
    source: payrollWednesday.source,
  },
  { scheduled: 4, regular: 4, paidFree: 0, source: 'schedule' },
  'Payroll must consume the unassigned technician individual schedule as four worked hours and zero synthetic paid-free time.',
);

assert.throws(() => buildEmployeeScheduleChanges({
  employee: technician,
  technicalVanAssigned: true,
  mode: 'custom',
  templateId: 'office-8-5',
  weeklySchedule: defaultEmployeeWeeklySchedule(),
  effectiveFrom: '2026-08-01',
  halfDayWeekday: 3,
}), /Van\/team/, 'The protected write path must still reject an individual schedule when a technical employee is assigned to a Van.');

console.log('Unassigned technician schedule acceptance passed: individual schedule authority when no Van, automatic Van precedence when assigned, preserved schedule restoration when unassigned again, payroll integration, and protected Sunday.');
