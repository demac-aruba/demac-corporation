import type { CanonicalOperationsState, CanonicalStaffAbsence, CanonicalStaffProfile } from './canonical-operations';
import {
  absenceForDate,
  payrollSettingsForEmployee,
  timesheetForDate,
  type EmployeeAttendanceState,
  type EmployeeTimesheetEntry,
  type PayrollPeriodBounds,
} from './employee-attendance';
import { activeSalaryAdvance } from './employee-advances';
import { resolveEmployeeSchedule } from './employee-work-schedule';

import { overtimeRateTotals } from './employee-attendance-calculation';

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
  overtime150Hours?: number;
  overtime200Hours?: number;
  overtimeUnassignedHours?: number;
  overtimeRateReviewRequired?: boolean;
  aoHours: number;
  vacationHours: number;
  noWorkNoPayHours: number;
  status: string;
  notes: string;
  source: 'timesheet' | 'absence' | 'schedule';
};

export type PayrollEmployeeSummary = {
  employee: CanonicalStaffProfile;
  employmentNotice?: string;
  employmentEndedInPeriod?: boolean;
  showWorkedHours?: boolean;
  weeklyPaidBaseHours: number;
  monthlyBaseHours: number;
  actualRegularHours: number;
  overtimeHours: number;
  overtime150Hours?: number;
  overtime200Hours?: number;
  overtimeUnassignedHours?: number;
  overtimeRateReviewRequired?: boolean;
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
  const rates = overtimeRateTotals(entry);
  return {
    overtime150Hours: rates.at150 / 60,
    overtime200Hours: rates.at200 / 60,
    overtimeUnassignedHours: rates.unassigned / 60,
    overtimeRateReviewRequired: rates.requiresReview,
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
    payrollSettings: payrollSettingsForEmployee(attendance.payrollSettings, employee),
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
      payrollSettings: payrollSettingsForEmployee(attendance.payrollSettings, employee),
      vans: operations.vans,
      halfDaySchedules: operations.vanHalfDaySchedules,
    });
    return sum + (schedule.scheduledMinutes + schedule.paidFreeMinutes) / 60;
  }, 0));
}

export function belongsToPayrollPeriod(employee: CanonicalStaffProfile, start: string, end: string, timesheets: EmployeeAttendanceState['timesheets']) {
  if (timesheets.some(entry => entry.employeeId === employee.id && entry.date >= start && entry.date <= end)) return true;
  const profile = employee as CanonicalStaffProfile & { employmentStartedAt?: string; employmentEndedAt?: string };
  if (profile.employmentStartedAt && profile.employmentStartedAt > end) return false;
  return profile.employmentEndedAt ? profile.employmentEndedAt >= start : profile.active !== false;
}

export function payrollReportEmployees(
  profiles: CanonicalStaffProfile[],
  period: PayrollPeriodBounds,
  attendance: EmployeeAttendanceState,
  bonusesByEmployee: Record<string, number>,
) {
  const advanceRecipients = new Set((attendance.advances ?? [])
    .filter(advance => advance.payrollPeriodId === period.id && activeSalaryAdvance(advance))
    .map(advance => advance.employeeId));
  return profiles.filter(employee =>
    bonusesByEmployee[employee.id] > 0 || advanceRecipients.has(employee.id)
    || belongsToPayrollPeriod(employee, period.start, period.end, attendance.timesheets));
}

function employmentChangesForPeriod(employee: CanonicalStaffProfile, period: PayrollPeriod) {
  const profile = employee as CanonicalStaffProfile & {
    employmentStartedAt?: string; startDate?: string; employmentEndedAt?: string; offboardingReason?: string;
  };
  const messages: string[] = [];
  const start = profile.employmentStartedAt || profile.startDate;
  const end = profile.employmentEndedAt;
  if (start && start >= period.startDate && start <= period.endDate) messages.push(`Started ${start}`);
  const employmentEndedInPeriod = Boolean(end && end >= period.startDate && end <= period.endDate);
  if (employmentEndedInPeriod) {
    const resigned = /^(resigned|resignation|renuncia|renuncio|renunció)(?:\s|$|[.,])/i.test(profile.offboardingReason?.trim() || '');
    messages.push(`${resigned ? 'Resigned' : 'Employment ended'} ${end}`);
  }
  return { employmentNotice: messages.join(' · '), employmentEndedInPeriod };
}

export function summarizeEmployee(input: {
  employee: CanonicalStaffProfile;
  period: PayrollPeriod;
  operations: CanonicalOperationsState;
  attendance: EmployeeAttendanceState;
}): PayrollEmployeeSummary {
  const { employee, period, operations, attendance } = input;
  const dates = payrollPeriodDates(period);
  const days = dates.map((date) => calculatePayrollDay({ employee, date, operations, attendance }));
  const total = (key: keyof Pick<PayrollDay, 'regularHours' | 'overtimeHours' | 'aoHours' | 'vacationHours' | 'noWorkNoPayHours' | 'paidFreeHours'>) => roundHours(days.reduce((sum, day) => sum + Number(day[key]), 0));
  const weeklyPaidBase = weeklyPaidBaseHours({ employee, period, operations, attendance });
  const changes = employmentChangesForPeriod(employee, period);
  const settings = payrollSettingsForEmployee(attendance.payrollSettings, employee);
  const showWorkedHours = changes.employmentEndedInPeriod || dates.some(date => resolveEmployeeSchedule({
    profile: employee, date, payrollSettings: settings, vans: operations.vans, halfDaySchedules: operations.vanHalfDaySchedules,
  }).partTime);
  const monthlyBase = changes.employmentNotice
    ? roundHours(days.reduce((sum, day) => sum + day.scheduledWorkHours, 0))
    : roundHours(weeklyPaidBase * MONTHLY_HOURS_FACTOR);
  const overtime = total('overtimeHours');
  const noWork = total('noWorkNoPayHours');
  return {
    employee,
    ...changes,
    showWorkedHours,
    weeklyPaidBaseHours: weeklyPaidBase,
    monthlyBaseHours: monthlyBase,
    actualRegularHours: total('regularHours'),
    overtimeHours: overtime,
    overtime150Hours: days.reduce((sum, day) => sum + (day.overtime150Hours ?? 0), 0),
    overtime200Hours: days.reduce((sum, day) => sum + (day.overtime200Hours ?? 0), 0),
    overtimeUnassignedHours: days.reduce((sum, day) => sum + (day.overtimeUnassignedHours ?? 0), 0),
    overtimeRateReviewRequired: days.some((day) => day.overtimeRateReviewRequired),
    aoHours: total('aoHours'),
    vacationHours: total('vacationHours'),
    noWorkNoPayHours: noWork,
    paidFreeHours: total('paidFreeHours'),
    payableHoursEstimate: roundHours(Math.max(0, monthlyBase - noWork) + overtime),
    exceptionDays: days.filter((day) => day.source !== 'schedule' || day.status !== 'Regular').length,
  };
}
