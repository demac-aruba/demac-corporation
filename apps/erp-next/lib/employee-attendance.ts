import { listFirestoreCollection, saveFirestoreDocument } from './firebase/firestore-rest';
import type { CanonicalStaffAbsence, CanonicalStaffProfile } from './canonical-operations';
import { saveCanonicalStaffAbsence } from './canonical-operations-mutations';

export type AttendanceStatus = 'Present' | 'Late' | 'Sick' | 'Vacation' | 'Day Off' | 'Absent';
export type SalaryAdvanceMethod = 'Cash' | 'Bank Transfer';

export type EmployeePayrollSettings = {
  id: string;
  sourceStaffId?: string;
  name?: string;
  role?: string;
  employeeType?: string;
  active?: boolean;
  weekdayHours?: number;
  saturdayHours?: number;
  weeklyHalfDayWeekday?: number;
  halfDayEffectiveFrom?: string;
  halfDayWorkedHours?: number;
  halfDayPaidFreeHours?: number;
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
  vacationHours?: number;
  noWorkNoPayHours: number;
  status: string;
  notes?: string;
  attendanceStatus?: AttendanceStatus;
  clockInTime?: string;
  clockOutTime?: string;
  breakMinutes?: number;
  lateMinutes?: number;
  workedMinutes?: number;
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
  overtimeMinutes: number;
  exceptionHours?: number;
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
  advances?: EmployeeSalaryAdvance[];
};

export type PayrollPeriodBounds = {
  id: string;
  start: string;
  end: string;
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  Present: 'Present',
  Late: 'Late',
  Sick: 'Sick / AO',
  Vacation: 'Vacation',
  'Day Off': 'Day Off',
  Absent: 'Absent / No Work No Pay',
};

function roundHours(minutes: number) {
  return Math.round((Math.max(0, minutes) / 60) * 100) / 100;
}

function roundNumberHours(hours: number) {
  return Math.round(Math.max(0, Number(hours) || 0) * 100) / 100;
}

function isSalaryAdvance(record: EmployeePayrollSettings | EmployeeSalaryAdvance): record is EmployeeSalaryAdvance {
  return 'recordType' in record && record.recordType === 'salaryAdvance';
}

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function payrollPeriodForDate(date: string) {
  const reference = new Date(`${date}T12:00:00Z`);
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const endMonth = reference.getUTCDate() <= 26 ? month : month + 1;
  const end = new Date(Date.UTC(year, endMonth, 26, 12));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 27, 12));
  return `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`;
}

export function payrollPeriodBounds(date: string): PayrollPeriodBounds {
  const id = payrollPeriodForDate(date);
  const [start, end] = id.split('_');
  return { id, start, end };
}

export function minutesBetween(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
}

export function lateMinutes(clockInTime: string, scheduledStartTime: string) {
  if (!clockInTime || !scheduledStartTime) return 0;
  return Math.max(0, minutesBetween(scheduledStartTime, clockInTime));
}

export function workedMinutes(clockInTime: string, clockOutTime: string, breakMinutes = 0) {
  if (!clockInTime || !clockOutTime) return 0;
  return Math.max(0, minutesBetween(clockInTime, clockOutTime) - Math.max(0, breakMinutes));
}

export function overtimeMinutesAfterFive(clockOutTime: string) {
  if (!clockOutTime) return 0;
  return Math.max(0, minutesBetween('17:00', clockOutTime));
}

export function defaultAttendanceSchedule(date: string): AttendanceSchedule {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return { startTime: '', endTime: '', scheduledMinutes: 0, paidFreeMinutes: 0, label: 'Company closed' };
  if (weekday === 6) return { startTime: '09:00', endTime: '13:00', scheduledMinutes: 240, paidFreeMinutes: 0, label: 'Saturday · 09:00–13:00' };
  return { startTime: '08:00', endTime: '17:00', scheduledMinutes: 480, paidFreeMinutes: 0, label: 'Weekday · 08:00–17:00 · lunch 12:00–13:00' };
}

export function applyHalfDaySchedule(
  schedule: AttendanceSchedule,
  date: string,
  weekday: number | undefined,
  workedHours: number | undefined,
  paidFreeHours: number | undefined,
  effectiveFrom?: string,
) {
  const dateWeekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === undefined || weekday !== dateWeekday || (effectiveFrom && date < effectiveFrom)) return schedule;
  const workedMinutesValue = Math.max(0, Math.round(Number(workedHours ?? 0) * 60));
  const paidFreeMinutesValue = Math.max(0, Math.round(Number(paidFreeHours ?? 0) * 60));
  if (!workedMinutesValue) return schedule;
  const startMinutes = schedule.startTime ? Number(schedule.startTime.slice(0, 2)) * 60 + Number(schedule.startTime.slice(3, 5)) : 8 * 60;
  const endMinutes = startMinutes + workedMinutesValue;
  const endHour = String(Math.floor(endMinutes / 60)).padStart(2, '0');
  const endMinute = String(endMinutes % 60).padStart(2, '0');
  return {
    ...schedule,
    endTime: `${endHour}:${endMinute}`,
    scheduledMinutes: workedMinutesValue,
    paidFreeMinutes: paidFreeMinutesValue,
    label: `Weekly half-day · ${roundHours(workedMinutesValue)} worked + ${roundHours(paidFreeMinutesValue)} paid free`,
  };
}

export function absenceForDate(absences: CanonicalStaffAbsence[], staffId: string, date: string) {
  return absences.find((absence) => absence.active !== false
    && absence.staffId === staffId
    && (!absence.fromDate || absence.fromDate <= date)
    && (!absence.toDate || absence.toDate >= date));
}

export function timesheetForDate(entries: EmployeeTimesheetEntry[], staffId: string, date: string) {
  return entries.find((entry) => entry.employeeId === staffId && entry.date === date);
}

export function statusFromRecords(
  entry: EmployeeTimesheetEntry | undefined,
  absence: CanonicalStaffAbsence | undefined,
  scheduledMinutes: number,
): AttendanceStatus | null {
  if (entry?.attendanceStatus) return entry.attendanceStatus;
  const reason = (absence?.reason ?? '').toLowerCase();
  if (reason.includes('enferm')) return 'Sick';
  if (reason.includes('vacacion')) return 'Vacation';
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
  const paidFreeHours = roundHours(schedule.paidFreeMinutes);
  const overtimeMinutesValue = Math.max(0, Math.round(Number(draft.overtimeMinutes) || 0));
  const exceptionStatus = draft.status === 'Sick' || draft.status === 'Vacation' || draft.status === 'Absent';
  const requestedExceptionHours = exceptionStatus
    ? draft.exceptionHours === undefined
      ? scheduledHours
      : roundNumberHours(draft.exceptionHours)
    : 0;
  const exceptionHours = Math.min(scheduledHours, requestedExceptionHours);
  const sickHours = draft.status === 'Sick' ? exceptionHours : 0;
  const vacationHours = draft.status === 'Vacation' ? exceptionHours : 0;
  const noWorkNoPayHours = draft.status === 'Absent' ? exceptionHours : 0;
  const regularHours = Math.max(0, Math.round((scheduledHours - sickHours - vacationHours - noWorkNoPayHours) * 100) / 100);
  const lateMinutesValue = draft.status === 'Late' ? lateMinutes(draft.clockInTime, schedule.startTime) : 0;
  const workedMinutesValue = workedMinutes(draft.clockInTime, draft.clockOutTime, draft.breakMinutes);

  const entry: EmployeeTimesheetEntry = {
    ...existingEntry,
    id: `${employee.id}_${date}`,
    payrollPeriodId: payrollPeriodForDate(date),
    employeeId: employee.id,
    employeeName: input.employee.name ?? input.employee.id,
    date,
    scheduledWorkHours: scheduledHours,
    paidFreeHours,
    regularHours,
    overtimeHours: roundHours(overtimeMinutesValue),
    overtimeMinutes: overtimeMinutesValue,
    aoHours: sickHours,
    vacationHours,
    noWorkNoPayHours,
    status: legacyPayrollStatus(draft.status, scheduledHours, exceptionHours),
    notes: draft.notes.trim(),
    attendanceStatus: draft.status,
    clockInTime: draft.clockInTime || undefined,
    clockOutTime: draft.clockOutTime || undefined,
    breakMinutes: Math.max(0, Math.round(Number(draft.breakMinutes) || 0)),
    lateMinutes: lateMinutesValue,
    workedMinutes: workedMinutesValue,
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
