import type { CanonicalOperationsState, CanonicalStaffProfile } from './canonical-operations';
import {
  absenceForDate,
  payrollSettingsForEmployee,
  statusFromRecords,
  timesheetForDate,
  type AttendanceStatus,
  type EmployeeAttendanceState,
} from './employee-attendance';
import { calculatePayrollDay, payrollPeriodDates, type PayrollPeriod } from './employee-payroll';
import { resolveEmployeeSchedule } from './employee-work-schedule';

export type AttendancePeriodBounds = {
  id: string;
  start: string;
  end: string;
};

export type AttendanceDayView = {
  schedule: ReturnType<typeof resolveEmployeeSchedule>;
  absence: ReturnType<typeof absenceForDate>;
  entry: ReturnType<typeof timesheetForDate>;
  status: AttendanceStatus | null;
  assumedRegular: boolean;
};

export type AttendancePeriodSummary = {
  scheduled: number;
  regular: number;
  overtime: number;
  ao: number;
  vacation: number;
  nwnp: number;
  paidFree: number;
  lateMinutes: number;
  recordedDays: number;
  exceptionDays: number;
};

function payrollPeriodFromBounds(period: AttendancePeriodBounds): PayrollPeriod {
  return {
    id: period.id,
    startDate: period.start,
    endDate: period.end,
    label: `${period.start} – ${period.end}`,
  };
}

function isExceptionDay(day: ReturnType<typeof calculatePayrollDay>) {
  // Normal scheduled days are synthesized and are never materialized. Therefore any
  // explicit timesheet is itself exception evidence, including a paid partial absence
  // that would otherwise look regular in aggregate payroll totals.
  return day.source === 'timesheet'
    || day.overtimeHours > 0
    || day.aoHours > 0
    || day.vacationHours > 0
    || day.noWorkNoPayHours > 0
    || /late/i.test(day.status)
    || (day.source === 'absence' && day.status !== 'Day Off');
}

/**
 * DEMAC attendance policy: the employee's configured work schedule is the normal case.
 * A missing attendance record does NOT mean missing attendance. It means the scheduled
 * regular hours are assumed unless an explicit exception overrides them.
 */
export function deriveAttendanceDay(input: {
  employee: CanonicalStaffProfile;
  date: string;
  operations: CanonicalOperationsState;
  attendance: EmployeeAttendanceState;
}): AttendanceDayView {
  const { employee, date, operations, attendance } = input;
  const schedule = resolveEmployeeSchedule({
    profile: employee,
    date,
    payrollSettings: payrollSettingsForEmployee(attendance.payrollSettings, employee),
    vans: operations.vans,
    halfDaySchedules: operations.vanHalfDaySchedules,
  });
  const absence = absenceForDate(operations.staffAbsences, employee.id, date);
  const entry = timesheetForDate(attendance.timesheets, employee.id, date);
  const explicitStatus = statusFromRecords(entry, absence, schedule.scheduledMinutes);
  const assumedRegular = !entry && !absence && schedule.scheduledMinutes > 0;

  return {
    schedule,
    absence,
    entry,
    status: explicitStatus ?? (assumedRegular ? 'Present' : null),
    assumedRegular,
  };
}

/**
 * Builds the attendance dashboard from the same payroll projection used by Payroll Review.
 * Normal scheduled days are derived in memory and are never materialized as daily attendance
 * documents. Only real exceptions need explicit records.
 */
export function summarizeAttendancePeriod(input: {
  employee: CanonicalStaffProfile;
  period: AttendancePeriodBounds;
  operations: CanonicalOperationsState;
  attendance: EmployeeAttendanceState;
}): AttendancePeriodSummary {
  const { employee, period, operations, attendance } = input;
  const days = payrollPeriodDates(payrollPeriodFromBounds(period)).map((date) => calculatePayrollDay({
    employee,
    date,
    operations,
    attendance,
  }));
  const explicitEntries = attendance.timesheets.filter((entry) => entry.employeeId === employee.id && entry.payrollPeriodId === period.id);
  const total = (selector: (day: (typeof days)[number]) => number) => days.reduce((sum, day) => sum + selector(day), 0);

  return {
    scheduled: total((day) => day.scheduledWorkHours),
    regular: total((day) => day.regularHours),
    overtime: total((day) => day.overtimeHours),
    ao: total((day) => day.aoHours),
    vacation: total((day) => day.vacationHours),
    nwnp: total((day) => day.noWorkNoPayHours),
    paidFree: total((day) => day.paidFreeHours),
    lateMinutes: explicitEntries.reduce((sum, entry) => sum + (entry.lateMinutes ?? 0), 0),
    recordedDays: explicitEntries.length,
    exceptionDays: days.filter(isExceptionDay).length,
  };
}
