import assert from 'node:assert/strict';
import type { CanonicalOperationsState, CanonicalStaffProfile } from '../lib/canonical-operations';
import { payrollPeriodBounds, type EmployeeAttendanceState, type EmployeeSalaryAdvance } from '../lib/employee-attendance';
import {
  buildEmployeeScheduleChanges,
  defaultEmployeeWeeklySchedule,
  type EmployeePayrollScheduleSettings,
} from '../lib/employee-schedule-settings';
import {
  belongsToPayrollPeriod,
  calculatePayrollDay,
  payrollReportEmployees,
  summarizeEmployee,
  payrollPeriodFromDates,
  weeklyPaidBaseHours,
} from '../lib/employee-payroll';

const employee: CanonicalStaffProfile = {
  id: 'staff-payroll-partial-day',
  name: 'Payroll Partial Day Test',
  employeeType: 'Secretaria',
  role: 'Secretaria',
  active: true,
  availability: 'Disponible',
};

const changes = buildEmployeeScheduleChanges({
  employee,
  mode: 'custom',
  templateId: 'late-9-6',
  weeklySchedule: defaultEmployeeWeeklySchedule('09:00', '18:00', 60),
  effectiveFrom: '2026-08-01',
  halfDayWeekday: 3,
  halfDayOffPeriod: 'afternoon',
  halfDayStartTime: '09:00',
  halfDayEndTime: '13:00',
  halfDayBreakMinutes: 0,
  now: '2026-08-27T22:30:00.000Z',
});
const payrollSettings: EmployeePayrollScheduleSettings = { id: employee.id, ...changes };

const operations = {
  staffProfiles: [employee],
  vans: [],
  vanHalfDaySchedules: [],
  staffAbsences: [],
} as unknown as CanonicalOperationsState;
const attendance: EmployeeAttendanceState = {
  payrollSettings: [payrollSettings],
  timesheets: [],
  advances: [],
};

const wednesday = calculatePayrollDay({
  employee,
  date: '2026-08-26',
  operations,
  attendance,
});
assert.deepEqual(
  {
    scheduled: wednesday.scheduledWorkHours,
    regular: wednesday.regularHours,
    paidFree: wednesday.paidFreeHours,
    source: wednesday.source,
  },
  { scheduled: 4, regular: 4, paidFree: 0, source: 'schedule' },
  'Payroll must receive a 09:00–13:00 partial day as exactly four regular worked hours and zero synthetic paid-free hours.',
);

const period = payrollPeriodFromDates('2026-07-27', '2026-08-26');
assert.equal(
  weeklyPaidBaseHours({ employee, period, operations, attendance }),
  44,
  'A Mon–Sat 09:00–18:00 schedule with one four-hour Wednesday partial day must project 44 scheduled worked hours for the standard week.',
);

console.log('Employee partial-day payroll acceptance passed: exact schedule hours reach payroll as worked time only, with zero synthetic paid-free hours.');

const former = { ...employee, active: false, employmentStartedAt: '2026-08-17', employmentEndedAt: '2026-08-19', offboardingReason: 'Renuncia' };
const input = { employee: former, period, attendance, operations };
const partialPeriod = summarizeEmployee(input);
assert.equal(partialPeriod.employmentNotice, 'Started 2026-08-17 · Resigned 2026-08-19');
assert.equal(partialPeriod.payableHoursEstimate, 20);
assert.equal(calculatePayrollDay({ ...input, date: '2026-08-20' }).regularHours, 0);
assert.equal(summarizeEmployee({ ...input, period: payrollPeriodFromDates('2026-08-27', '2026-09-26') }).employmentNotice, '');

const novemberDeparture = { ...former, employmentEndedAt: '2026-11-12' };
assert.equal(belongsToPayrollPeriod(novemberDeparture, '2026-10-27', '2026-11-26', []), true);
assert.equal(belongsToPayrollPeriod(novemberDeparture, '2026-11-27', '2026-12-26', []), false);

const november = payrollPeriodBounds('2026-11-12');
const december = payrollPeriodBounds('2026-11-27');
const archived = { active: false, employmentEndedAt: '2026-10-26' };
const profiles = [
  novemberDeparture,
  { id: 'closing-day-hire', active: true, employmentStartedAt: november.end },
  { id: 'opening-day-departure', active: false, employmentEndedAt: november.start },
  { id: 'future-hire', active: true, employmentStartedAt: december.start },
  { id: 'legacy-timesheet', active: false },
  { id: 'bonus-only', ...archived },
  { id: 'advance-only', ...archived },
  { id: 'voided-advance', ...archived },
  { id: 'next-advance', ...archived },
];
const advance: EmployeeSalaryAdvance = {
  id: 'test-advance', recordType: 'salaryAdvance', employeeId: 'advance-only', employeeName: 'Test',
  payrollPeriodId: november.id, date: november.end, amount: 50, method: 'Cash',
  createdAt: '2026-11-26T12:00:00Z', updatedAt: '2026-11-26T12:00:00Z',
};
const reportAttendance: EmployeeAttendanceState = {
  payrollSettings: [],
  timesheets: [{
    id: 'legacy-timesheet-entry', employeeId: 'legacy-timesheet', employeeName: 'Test', date: november.start,
    payrollPeriodId: november.id, status: 'Present', regularHours: 4, scheduledWorkHours: 4,
    overtimeHours: 0, aoHours: 0, noWorkNoPayHours: 0, paidFreeHours: 0, updatedAt: '2026-10-27T12:00:00Z',
  }],
  advances: [
    advance,
    { ...advance, id: 'test-void', employeeId: 'voided-advance', status: 'voided' },
    { ...advance, id: 'test-next', employeeId: 'next-advance', payrollPeriodId: december.id, date: december.start },
  ],
};
assert.deepEqual(
  payrollReportEmployees(profiles, november, reportAttendance, { 'bonus-only': 25, 'advance-only': 10 }).map(profile => profile.id).sort(),
  ['advance-only', 'bonus-only', 'closing-day-hire', 'legacy-timesheet', 'opening-day-departure', novemberDeparture.id].sort(),
  'A report includes overlapping employment, dated attendance and active period adjustments exactly once.',
);
assert.deepEqual(
  payrollReportEmployees(profiles, december, reportAttendance, {}).map(profile => profile.id).sort(),
  ['closing-day-hire', 'future-hire', 'next-advance'].sort(),
  'A later report excludes departed staff without new attendance or adjustments.',
);
