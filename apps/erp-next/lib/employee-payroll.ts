import type { CanonicalOperationsState, CanonicalStaffAbsence, CanonicalStaffProfile } from './canonical-operations';
import {
  absenceForDate,
  payrollSettingsForStaff,
  timesheetForDate,
  type EmployeeAttendanceState,
  type EmployeeTimesheetEntry,
} from './employee-attendance';
import { resolveEmployeeSchedule } from './employee-work-schedule';

export const MONTHLY_HOURS_FACTOR = 4.333;

export type PayrollPeriod = {
  id: string;
  startDate: string;
  endDate: string;
  label: string;
};

export type PayrollDay = {
  employeeId: string;
  date: string;
  scheduledWorkHours: number;
  paidFreeHours: number;
  regularHours: number;
  overtimeHours: number;
  aoHours: number;
  vacationHours: number;
  noWorkNoPayHours: number;
  status: string;
  notes: string;
  source: 'timesheet' | 'absence' | 'schedule';
};

export type PayrollEmployeeSummary = {
  employee: CanonicalStaffProfile;
  weeklyPaidBaseHours: number;
  monthlyBaseHours: number;
  actualRegularHours: number;
  overtimeHours: number;
  aoHours: number;
  vacationHours: number;
  noWorkNoPayHours: number;
  paidFreeHours: number;
  payableHoursEstimate: number;
  exceptionDays: number;
};

function parseDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function roundHours(value: number) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

export function payrollPeriodForReference(reference = new Date()): PayrollPeriod {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const endMonth = reference.getDate() <= 26 ? month : month + 1;
  const end = new Date(Date.UTC(year, endMonth, 26, 12));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 27, 12));
  return payrollPeriodFromDates(isoDate(start), isoDate(end));
}

export function payrollPeriodFromDates(startDate: string, endDate: string): PayrollPeriod {
  const formatter: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return {
    id: `${startDate}_${endDate}`,
    startDate,
    endDate,
    label: `${parseDate(startDate).toLocaleDateString('en-AW', formatter)} – ${parseDate(endDate).toLocaleDateString('en-AW', formatter)}`,
  };
}

export function shiftPayrollPeriod(period: PayrollPeriod, months: number) {
  const end = parseDate(period.endDate);
  const shiftedEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + months, 26, 12));
  const shiftedStart = new Date(Date.UTC(shiftedEnd.getUTCFullYear(), shiftedEnd.getUTCMonth() - 1, 27, 12));
  return payrollPeriodFromDates(isoDate(shiftedStart), isoDate(shiftedEnd));
}

export function payrollPeriodDates(period: PayrollPeriod) {
  const dates: string[] = [];
  const cursor = parseDate(period.startDate);
  const end = parseDate(period.endDate);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function absenceStatus(absence: CanonicalStaffAbsence | undefined) {
  const reason = (absence?.reason ?? '').toLowerCase();
  if (reason.includes('enferm')) return 'Sick / AO';
  if (reason.includes('vacacion')) return 'Vacation';
  if (reason.includes('libre')) return 'Day Off';
  return absence ? 'Absent / No Work No Pay' : '';
}

function dayFromTimesheet(entry: EmployeeTimesheetEntry, scheduledHours: number, scheduledPaidFree: number): PayrollDay {
  return {
    employeeId: entry.employeeId,
    date: entry.date,
    scheduledWorkHours: roundHours(entry.scheduledWorkHours ?? scheduledHours),
    paidFreeHours: roundHours(entry.paidFreeHours ?? scheduledPaidFree),
    regularHours: roundHours(entry.regularHours),
    overtimeHours: roundHours(entry.overtimeHours),
    aoHours: roundHours(entry.aoHours),
    vacationHours: roundHours(entry.vacationHours ?? 0),
    noWorkNoPayHours: roundHours(entry.noWorkNoPayHours),
    status: entry.status || entry.attendanceStatus || 'Regular',
    notes: entry.notes ?? '',
    source: 'timesheet',
  };
}

export function calculatePayrollDay(input: {
  employee: CanonicalStaffProfile;
  date: string;
  operations: CanonicalOperationsState;
  attendance: EmployeeAttendanceState;
}): PayrollDay {
  const { employee, date, operations, attendance } = input;
  const schedule = resolveEmployeeSchedule({
    profile: employee,
    date,
    payrollSettings: payrollSettingsForStaff(attendance.payrollSettings, employee.id),
    vans: operations.vans,
    halfDaySchedules: operations.vanHalfDaySchedules,
  });
  const scheduledHours = roundHours(schedule.scheduledMinutes / 60);
  const scheduledPaidFree = roundHours(schedule.paidFreeMinutes / 60);
  const entry = timesheetForDate(attendance.timesheets, employee.id, date);
  if (entry) return dayFromTimesheet(entry, scheduledHours, scheduledPaidFree);

  const absence = absenceForDate(operations.staffAbsences, employee.id, date);
  if (absence) {
    const status = absenceStatus(absence);
    const sick = status === 'Sick / AO' ? scheduledHours : 0;
    const vacation = status === 'Vacation' ? scheduledHours : 0;
    const dayOff = status === 'Day Off';
    const noWork = status === 'Absent / No Work No Pay' ? scheduledHours : 0;
    return {
      employeeId: employee.id,
      date,
      scheduledWorkHours: scheduledHours,
      paidFreeHours: roundHours(scheduledPaidFree + (dayOff ? scheduledHours : 0)),
      regularHours: 0,
      overtimeHours: 0,
      aoHours: sick,
      vacationHours: vacation,
      noWorkNoPayHours: noWork,
      status,
      notes: absence.notes ?? '',
      source: 'absence',
    };
  }

  return {
    employeeId: employee.id,
    date,
    scheduledWorkHours: scheduledHours,
    paidFreeHours: scheduledPaidFree,
    regularHours: scheduledHours,
    overtimeHours: 0,
    aoHours: 0,
    vacationHours: 0,
    noWorkNoPayHours: 0,
    status: scheduledHours > 0 || scheduledPaidFree > 0 ? 'Regular' : 'No shift',
    notes: '',
    source: 'schedule',
  };
}

function standardWeekDates(period: PayrollPeriod) {
  const end = parseDate(period.endDate);
  const weekday = end.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(end);
  monday.setUTCDate(end.getUTCDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return isoDate(date);
  });
}

export function weeklyPaidBaseHours(input: {
  employee: CanonicalStaffProfile;
  period: PayrollPeriod;
  operations: CanonicalOperationsState;
  attendance: EmployeeAttendanceState;
}) {
  const { employee, period, operations, attendance } = input;
  return roundHours(standardWeekDates(period).reduce((sum, date) => {
    const schedule = resolveEmployeeSchedule({
      profile: employee,
      date,
      payrollSettings: payrollSettingsForStaff(attendance.payrollSettings, employee.id),
      vans: operations.vans,
      halfDaySchedules: operations.vanHalfDaySchedules,
    });
    return sum + (schedule.scheduledMinutes + schedule.paidFreeMinutes) / 60;
  }, 0));
}

export function summarizeEmployee(input: {
  employee: CanonicalStaffProfile;
  period: PayrollPeriod;
  operations: CanonicalOperationsState;
  attendance: EmployeeAttendanceState;
}): PayrollEmployeeSummary {
  const { employee, period, operations, attendance } = input;
  const days = payrollPeriodDates(period).map((date) => calculatePayrollDay({ employee, date, operations, attendance }));
  const total = (key: keyof Pick<PayrollDay, 'regularHours' | 'overtimeHours' | 'aoHours' | 'vacationHours' | 'noWorkNoPayHours' | 'paidFreeHours'>) => roundHours(days.reduce((sum, day) => sum + Number(day[key]), 0));
  const weeklyPaidBase = weeklyPaidBaseHours({ employee, period, operations, attendance });
  const monthlyBase = roundHours(weeklyPaidBase * MONTHLY_HOURS_FACTOR);
  const overtime = total('overtimeHours');
  const noWork = total('noWorkNoPayHours');
  return {
    employee,
    weeklyPaidBaseHours: weeklyPaidBase,
    monthlyBaseHours: monthlyBase,
    actualRegularHours: total('regularHours'),
    overtimeHours: overtime,
    aoHours: total('aoHours'),
    vacationHours: total('vacationHours'),
    noWorkNoPayHours: noWork,
    paidFreeHours: total('paidFreeHours'),
    payableHoursEstimate: roundHours(Math.max(0, monthlyBase - noWork) + overtime),
    exceptionDays: days.filter((day) => day.source !== 'schedule' || day.status !== 'Regular').length,
  };
}
