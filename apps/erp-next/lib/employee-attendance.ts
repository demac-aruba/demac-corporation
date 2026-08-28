import { listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';
import type { CanonicalStaffAbsence, CanonicalStaffProfile } from './canonical-operations';
import { saveCanonicalStaffAbsence } from './canonical-operations-mutations';
import {
  attendanceExceptionTotals,
  calculateAttendanceVariance,
  classifyAttendanceExceptions,
  hasValidWorkedTimeRange,
  minutesBetween,
  scheduledBreakMinutes,
  workedMinutes,
  type AttendanceExceptionClassification,
  type AttendanceExceptionSegment,
} from './employee-attendance-calculation';

export { minutesBetween, workedMinutes } from './employee-attendance-calculation';
export type {
  AttendanceExceptionClassification,
  AttendanceExceptionKind,
  AttendanceExceptionSegment,
  AttendancePaymentTreatment,
} from './employee-attendance-calculation';

export type AttendanceStatus = 'Present' | 'Late' | 'Sick' | 'Vacation' | 'Day Off' | 'Absent';
export type SalaryAdvanceMethod = 'Cash' | 'Bank Transfer';

export type EmployeePayrollSettings = {
  id: string;
  sourceStaffId?: string;
  name: string;
  role?: string;
  employeeType?: CanonicalStaffProfile['employeeType'];
  active: boolean;
  weekdayHours: number;
  saturdayHours: number;
  weeklyHalfDayWeekday?: number | null;
  halfDayEffectiveFrom?: string;
  halfDayWorkedHours?: number;
  halfDayPaidFreeHours?: number;
  halfDayOffPeriod?: 'morning' | 'afternoon';
  scheduleMode?: 'company' | 'custom';
  scheduleTemplateId?: string;
  weeklySchedule?: Record<string, unknown>;
  scheduleEffectiveFrom?: string;
  scheduleEffectiveUntil?: string | null;
  scheduleVersions?: unknown[];
  halfDayUsesExactHours?: boolean;
  halfDayStartTime?: string | null;
  halfDayEndTime?: string | null;
  halfDayBreakMinutes?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type EmployeeTimesheetEntry = {
  id: string;
  payrollPeriodId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  scheduledWorkHours: number;
  paidFreeHours: number;
  regularHours: number;
  overtimeHours: number;
  overtimeMinutes?: number;
  aoHours: number;
  vacationHours: number;
  noWorkNoPayHours: number;
  status: string;
  notes: string;
  attendanceStatus?: AttendanceStatus;
  clockInTime?: string;
  clockOutTime?: string;
  breakMinutes?: number;
  lateMinutes?: number;
  workedMinutes?: number;
  attendanceExceptions?: AttendanceExceptionSegment[];
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  scheduledBreakMinutes?: number;
  scheduledPaidFreeMinutes?: number;
  createdAt?: string;
  updatedAt: string;
  updatedByUserId?: string;
  updatedByName?: string;
};

export type EmployeeSalaryAdvance = {
  id: string;
  recordType: 'salaryAdvance';
  employeeId: string;
  employeeName: string;
  date: string;
  payrollPeriodId: string;
  amount: number;
  method: SalaryAdvanceMethod;
  reference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  recordedByUserId?: string;
  recordedByName?: string;
};

export type AttendanceDayDraft = {
  status: AttendanceStatus;
  clockInTime: string;
  clockOutTime: string;
  breakMinutes: number;
  /** Legacy draft field retained for compatibility. saveAttendanceDay does not trust it. */
  overtimeMinutes: number;
  exceptionHours?: number;
  attendanceExceptionClassifications?: AttendanceExceptionClassification[];
  notes: string;
};

export type AttendanceSchedule = {
  startTime: string;
  endTime: string;
  scheduledMinutes: number;
  paidFreeMinutes: number;
  label: string;
};

export type EmployeeAttendanceState = {
  payrollSettings: EmployeePayrollSettings[];
  timesheets: EmployeeTimesheetEntry[];
  advances: EmployeeSalaryAdvance[];
};

export type PayrollPeriodBounds = {
  id: string;
  start: string;
  end: string;
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  Present: 'Present',
  Late: 'Late',
  Sick: 'AO / Sick',
  Vacation: 'Vacation',
  'Day Off': 'Day Off',
  Absent: 'No Work No Pay',
};

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function monthLastDay(year: number, monthOneBased: number) {
  return new Date(Date.UTC(year, monthOneBased, 0, 12, 0, 0));
}

export function payrollPeriodForDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (day >= 27) {
    const end = new Date(Date.UTC(year, month + 1, 26, 12, 0, 0));
    const start = new Date(Date.UTC(year, month, 27, 12, 0, 0));
    return `${dateKey(start)}_${dateKey(end)}`;
  }
  const end = new Date(Date.UTC(year, month, 26, 12, 0, 0));
  const start = new Date(Date.UTC(year, month - 1, 27, 12, 0, 0));
  return `${dateKey(start)}_${dateKey(end)}`;
}

export function payrollPeriodBounds(value: string): PayrollPeriodBounds {
  const id = payrollPeriodForDate(value);
  const [start, end] = id.split('_');
  return { id, start, end };
}

export function lateMinutes(clockInTime: string, scheduledStartTime: string) {
  if (!clockInTime || !scheduledStartTime) return 0;
  return Math.max(0, minutesBetween(scheduledStartTime, clockInTime));
}

/** @deprecated Overtime must be derived from the employee's resolved schedule. */
export function overtimeMinutesAfterFive(clockOutTime: string) {
  if (!clockOutTime) return 0;
  return Math.max(0, minutesBetween('17:00', clockOutTime));
}

export function defaultAttendanceSchedule(date: string): AttendanceSchedule {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return { startTime: '', endTime: '', scheduledMinutes: 0, paidFreeMinutes: 0, label: 'Company closed · Sunday' };
  return { startTime: '08:00', endTime: '17:00', scheduledMinutes: 480, paidFreeMinutes: 0, label: weekday === 6 ? 'Saturday · 8h' : 'Company schedule · 8h' };
}

function isSalaryAdvance(record: EmployeePayrollSettings | EmployeeSalaryAdvance): record is EmployeeSalaryAdvance {
  return (record as EmployeeSalaryAdvance).recordType === 'salaryAdvance';
}

function normalizedEmployeeName(name?: string) {
  return (name ?? '').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
}

function roundNumberHours(value: number) {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

function roundHours(minutes: number) {
  return Math.round((Math.max(0, minutes) / 60) * 100) / 100;
}

export function absenceForDate(absences: CanonicalStaffAbsence[], employeeId: string, date: string) {
  return absences.find((absence) => absence.active !== false && absence.staffId === employeeId && date >= (absence.fromDate ?? '') && date <= (absence.toDate ?? absence.fromDate ?? ''));
}

export function timesheetForDate(entries: EmployeeTimesheetEntry[], employeeId: string, date: string) {
  return entries.find((entry) => entry.employeeId === employeeId && entry.date === date);
}

export function statusFromRecords(entry: EmployeeTimesheetEntry | undefined, absence: CanonicalStaffAbsence | undefined, scheduledMinutes: number): AttendanceStatus | null {
  if (entry?.attendanceStatus) return entry.attendanceStatus;
  const reason = (absence?.reason ?? '').toLowerCase();
  if (reason.includes('vac')) return 'Vacation';
  if (reason.includes('enferm') || reason.includes('sick') || reason.includes('ao')) return 'Sick';
  if (reason.includes('libre')) return 'Day Off';
  if (absence) return 'Absent';
  if ((entry?.aoHours ?? 0) > 0) return 'Sick';
  if ((entry?.vacationHours ?? 0) > 0) return 'Vacation';
  if ((entry?.noWorkNoPayHours ?? 0) > 0 && (entry?.noWorkNoPayHours ?? 0) * 60 >= scheduledMinutes) return 'Absent';
  if ((entry?.lateMinutes ?? 0) > 0) return 'Late';
  if (entry) return 'Present';
  return null;
}

function legacyPayrollStatus(status: AttendanceStatus, scheduledHours: number, exceptionHours: number) {
  if (!scheduledHours) return 'Sin jornada';
  const complete = exceptionHours >= scheduledHours;
  if (status === 'Sick') return complete ? 'AO completo' : 'AO parcial';
  if (status === 'Vacation') return complete ? 'Vacaciones completo' : 'Vacaciones parcial';
  if (status === 'Absent') return complete ? 'No Work No Pay completo' : 'No Work No Pay parcial';
  if (status === 'Day Off') return 'Día libre programado';
  return 'Regular';
}

export async function loadEmployeePayrollSettings(): Promise<EmployeePayrollSettings[]> {
  const records = await listFirestoreCollection<EmployeePayrollSettings | EmployeeSalaryAdvance>('employeePayrollSettings');
  return records.filter((record): record is EmployeePayrollSettings => !isSalaryAdvance(record));
}

export async function loadEmployeeAttendanceState(): Promise<EmployeeAttendanceState> {
  const [payrollRecords, timesheets] = await Promise.all([
    listFirestoreCollection<EmployeePayrollSettings | EmployeeSalaryAdvance>('employeePayrollSettings'),
    listFirestoreCollection<EmployeeTimesheetEntry>('employeeTimesheets'),
  ]);
  const advances = payrollRecords.filter(isSalaryAdvance);
  const payrollSettings = payrollRecords.filter((record): record is EmployeePayrollSettings => !isSalaryAdvance(record));
  return { payrollSettings, timesheets, advances };
}

export function payrollSettingsForStaff(settings: EmployeePayrollSettings[], staffId: string) {
  return settings.find((entry) => (entry.sourceStaffId ?? entry.id) === staffId);
}

export function payrollSettingsForEmployee(settings: EmployeePayrollSettings[], employee: CanonicalStaffProfile) {
  const exact = payrollSettingsForStaff(settings, employee.id);
  if (exact) return exact;
  const name = normalizedEmployeeName(employee.name);
  if (!name) return undefined;
  const matches = settings.filter((entry) => normalizedEmployeeName(entry.name) === name);
  return matches.length === 1 ? matches[0] : undefined;
}

/** @deprecated Existing employee schedule editing uses saveEmployeeScheduleSettings with exact partial-day times. */
export async function saveEmployeeHalfDaySettings(input: {
  employee: CanonicalStaffProfile;
  existing?: EmployeePayrollSettings;
  weekday: number;
  offPeriod: HalfDayOffPeriod;
  effectiveFrom: string;
}) {
  const weekday = Math.round(Number(input.weekday));
  if (weekday < 1 || weekday > 6) throw new Error('Choose a weekday from Monday through Saturday.');
  if (!input.effectiveFrom) throw new Error('Choose when the recurring partial day becomes effective.');
  const now = new Date().toISOString();
  const id = input.existing?.id ?? input.employee.id;
  const changes: Omit<EmployeePayrollSettings, 'id'> = {
    sourceStaffId: input.employee.id,
    name: input.employee.name,
    role: input.employee.role,
    employeeType: input.employee.employeeType,
    active: input.employee.active !== false,
    weekdayHours: input.existing?.weekdayHours ?? 8,
    saturdayHours: input.existing?.saturdayHours ?? 8,
    weeklyHalfDayWeekday: weekday,
    halfDayEffectiveFrom: input.effectiveFrom,
    halfDayWorkedHours: 4,
    halfDayPaidFreeHours: 0,
    halfDayOffPeriod: input.offPeriod,
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (input.existing) return updateFirestoreDocument<EmployeePayrollSettings>('employeePayrollSettings', id, changes as Record<string, unknown>);
  return saveFirestoreDocument<EmployeePayrollSettings>('employeePayrollSettings', { id, ...changes });
}

export async function saveSalaryAdvance(input: {
  employee: CanonicalStaffProfile;
  date: string;
  amount: number;
  method: SalaryAdvanceMethod;
  reference?: string;
  notes?: string;
  recordedByUserId?: string;
  recordedByName?: string;
}) {
  const amount = Math.round(Math.max(0, Number(input.amount) || 0) * 100) / 100;
  if (!amount) throw new Error('Advance amount must be greater than zero.');
  const now = new Date().toISOString();
  const id = `advance-${input.employee.id}-${input.date}-${Date.now()}`;
  const advance: EmployeeSalaryAdvance = {
    id,
    recordType: 'salaryAdvance',
    employeeId: input.employee.id,
    employeeName: input.employee.name ?? input.employee.id,
    date: input.date,
    payrollPeriodId: payrollPeriodForDate(input.date),
    amount,
    method: input.method,
    reference: input.reference?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    recordedByUserId: input.recordedByUserId,
    recordedByName: input.recordedByName,
  };
  // Salary advances are payroll-sensitive records. They intentionally share the protected
  // employeePayrollSettings collection so existing payroll-only Firestore permissions apply.
  await saveFirestoreDocument('employeePayrollSettings', advance);
  return advance;
}

export async function saveAttendanceDay(input: {
  employee: CanonicalStaffProfile;
  date: string;
  schedule: AttendanceSchedule;
  draft: AttendanceDayDraft;
  existingEntry?: EmployeeTimesheetEntry;
  existingAbsence?: CanonicalStaffAbsence;
  updatedByUserId?: string;
  updatedByName?: string;
}) {
  const { employee, date, schedule, draft, existingEntry, existingAbsence, updatedByUserId, updatedByName } = input;
  const now = new Date().toISOString();
  const scheduledHours = roundHours(schedule.scheduledMinutes);
  const scheduledPaidFreeMinutes = Math.max(0, Math.round(schedule.paidFreeMinutes));
  const scheduledBreakMinutesValue = scheduledBreakMinutes(schedule);
  const exceptionStatus = draft.status === 'Sick' || draft.status === 'Vacation' || draft.status === 'Absent';
  const workedStatus = draft.status === 'Present' || draft.status === 'Late';

  if (workedStatus && schedule.scheduledMinutes > 0) {
    if (!draft.clockInTime || !draft.clockOutTime) throw new Error('Clock In and Clock Out are required for a worked attendance day.');
    if (!hasValidWorkedTimeRange(draft.clockInTime, draft.clockOutTime)) throw new Error('Clock Out must be later than Clock In.');
  }

  const variance = calculateAttendanceVariance({
    schedule,
    clockInTime: draft.clockInTime,
    clockOutTime: draft.clockOutTime,
    breakMinutes: draft.breakMinutes,
  });
  const attendanceExceptions = workedStatus
    ? classifyAttendanceExceptions(variance, draft.attendanceExceptionClassifications)
    : [];
  const partialTotals = attendanceExceptionTotals(attendanceExceptions);

  const requestedExceptionHours = exceptionStatus
    ? draft.exceptionHours === undefined
      ? scheduledHours
      : roundNumberHours(draft.exceptionHours)
    : 0;
  const exceptionHours = Math.min(scheduledHours, requestedExceptionHours);
  const sickHours = draft.status === 'Sick' ? exceptionHours : 0;
  const vacationHours = draft.status === 'Vacation' ? exceptionHours : 0;
  const fullDayNoWorkNoPayHours = draft.status === 'Absent' ? exceptionHours : 0;

  const regularMinutesValue = workedStatus
    ? Math.max(0, schedule.scheduledMinutes - variance.missingScheduledMinutes)
    : Math.max(0, schedule.scheduledMinutes - Math.round((sickHours + vacationHours + fullDayNoWorkNoPayHours) * 60));
  const paidFreeMinutesValue = scheduledPaidFreeMinutes + (workedStatus ? partialTotals.paidMinutes : 0);
  const noWorkNoPayMinutesValue = workedStatus
    ? partialTotals.noWorkNoPayMinutes
    : Math.round(fullDayNoWorkNoPayHours * 60);
  const overtimeMinutesValue = workedStatus ? variance.overtimeMinutes : 0;
  const workedMinutesValue = workedMinutes(draft.clockInTime, draft.clockOutTime, draft.breakMinutes);

  const entry: EmployeeTimesheetEntry = {
    ...existingEntry,
    id: `${employee.id}_${date}`,
    payrollPeriodId: payrollPeriodForDate(date),
    employeeId: employee.id,
    employeeName: input.employee.name ?? input.employee.id,
    date,
    scheduledWorkHours: scheduledHours,
    paidFreeHours: roundHours(paidFreeMinutesValue),
    regularHours: roundHours(regularMinutesValue),
    overtimeHours: roundHours(overtimeMinutesValue),
    overtimeMinutes: overtimeMinutesValue,
    aoHours: sickHours,
    vacationHours,
    noWorkNoPayHours: roundHours(noWorkNoPayMinutesValue),
    status: legacyPayrollStatus(draft.status, scheduledHours, exceptionStatus ? exceptionHours : roundHours(variance.missingScheduledMinutes)),
    notes: draft.notes.trim(),
    attendanceStatus: draft.status,
    clockInTime: draft.clockInTime || undefined,
    clockOutTime: draft.clockOutTime || undefined,
    breakMinutes: Math.max(0, Math.round(Number(draft.breakMinutes) || 0)),
    lateMinutes: workedStatus ? variance.lateArrivalMinutes : 0,
    workedMinutes: workedMinutesValue,
    attendanceExceptions,
    scheduledStartTime: schedule.startTime || undefined,
    scheduledEndTime: schedule.endTime || undefined,
    scheduledBreakMinutes: scheduledBreakMinutesValue,
    scheduledPaidFreeMinutes,
    createdAt: existingEntry?.createdAt ?? now,
    updatedAt: now,
    updatedByUserId,
    updatedByName,
  };

  await saveFirestoreDocument('employeeTimesheets', entry);

  const fullDayException = scheduledHours > 0 && exceptionHours >= scheduledHours;
  const desiredAbsenceReason = fullDayException && draft.status === 'Sick'
    ? 'Enfermo'
    : fullDayException && draft.status === 'Vacation'
      ? 'Vacaciones'
      : draft.status === 'Day Off'
        ? 'Libre'
        : fullDayException && draft.status === 'Absent'
          ? 'Otro'
          : null;

  if (desiredAbsenceReason) {
    if (!existingAbsence) {
      await saveCanonicalStaffAbsence({
        id: `attendance-${employee.id}-${date}`,
        staffId: employee.id,
        fromDate: date,
        toDate: date,
        reason: desiredAbsenceReason,
        notes: draft.notes.trim() || undefined,
        active: true,
      });
    } else if (existingAbsence.id.startsWith('attendance-') && existingAbsence.fromDate === date && existingAbsence.toDate === date) {
      await saveCanonicalStaffAbsence({
        ...existingAbsence,
        reason: desiredAbsenceReason,
        notes: draft.notes.trim() || existingAbsence.notes,
        active: true,
      });
    }
  } else if (existingAbsence?.id.startsWith('attendance-') && existingAbsence.fromDate === date && existingAbsence.toDate === date) {
    await saveCanonicalStaffAbsence({ ...existingAbsence, active: false });
  }

  return entry;
}

function shiftMonth(value: string, offset: number) {
  const date = new Date(`${value}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftDateMonth(value: string, offset: number) {
  const month = shiftMonth(value.slice(0, 7), offset);
  const day = Math.min(Number(value.slice(8, 10)), monthLastDay(Number(month.slice(0, 4)), Number(month.slice(5, 7))).getUTCDate());
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function defaultPeriodEnd(value: string) {
  const bounds = payrollPeriodBounds(value);
  return addDays(bounds.start, 30);
}
