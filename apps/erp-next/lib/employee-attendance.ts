import { listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument, mutateFirestoreDocumentWithReads } from './firebase/firestore-rest';
import type { CanonicalStaffAbsence, CanonicalStaffProfile } from './canonical-operations';
import type { PayrollAdjustment } from './employee-bonuses';
import { saveCanonicalStaffAbsence } from './canonical-operations-mutations';
import {
  attendanceExceptionTotals,
  calculateAttendanceVarianceWithWorkSegments,
  classifyAttendanceExceptions,
  hasValidWorkedTimeRange,
  minutesBetween,
  scheduledBreakMinutes,
  type AttendanceExceptionClassification,
  type AttendanceExceptionSegment,
  type AttendanceWorkSegment,
  normalizeAttendanceIntervals,
  attendanceWorkWindows,
  validateOvertimePayAllocations,
  type AttendanceWorkInterval,
  type OvertimePayAllocation,
} from './employee-attendance-calculation';

export { minutesBetween, workedMinutes } from './employee-attendance-calculation';
export type {
  AttendanceExceptionClassification,
  AttendanceExceptionKind,
  AttendanceExceptionSegment,
  AttendancePaymentTreatment,
  AttendanceWorkSegment,
  AttendanceWorkInterval,
  OvertimePayAllocation,
} from './employee-attendance-calculation';

export type AttendanceStatus = 'Present' | 'Late' | 'Sick' | 'Vacation' | 'Day Off' | 'Absent';
export type SalaryAdvanceMethod = 'Cash' | 'Bank Transfer';
export type HalfDayOffPeriod = 'morning' | 'afternoon';

export type EmployeePayrollSettings = {
  id: string;
  payrollAdjustments?: PayrollAdjustment[];
  sourceStaffId?: string;
  name?: string;
  role?: string;
  employeeType?: string;
  active?: boolean;
  weekdayHours?: number;
  saturdayHours?: number;
  weeklyHalfDayWeekday?: number | null;
  halfDayEffectiveFrom?: string | null;
  halfDayWorkedHours?: number;
  halfDayPaidFreeHours?: number;
  halfDayOffPeriod?: HalfDayOffPeriod;
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
  attendanceExceptions?: AttendanceExceptionSegment[];
  workOrderAttendanceSegments?: AttendanceWorkSegment[];
  workIntervals?: AttendanceWorkInterval[];
  overtimePayAllocations?: OvertimePayAllocation[];
  attendanceChangeReason?: string;
  attendanceHistory?: Array<{ id: string; at: string; actorId: string; actorName: string; reason: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>;
  overtimeCalculationSource?: 'attendance_authority' | 'attendance_authority_with_work_segments';
  overtimeReconciliationRequired?: boolean;
  lastWorkOrderCompletedAt?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  scheduledBreakMinutes?: number;
  scheduledPaidFreeMinutes?: number;
  scheduleSnapshotSource?: string;
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
  workIntervals?: AttendanceWorkInterval[];
  overtimePayAllocations?: OvertimePayAllocation[];
  changeReason?: string;
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

function normalizedEmployeeName(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
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

export function lateMinutes(clockInTime: string, scheduledStartTime: string) {
  if (!clockInTime || !scheduledStartTime) return 0;
  return Math.max(0, minutesBetween(scheduledStartTime, clockInTime));
}

/** @deprecated Overtime must be derived from the employee's resolved schedule and real work evidence. */
export function overtimeMinutesAfterFive(clockOutTime: string) {
  if (!clockOutTime) return 0;
  return Math.max(0, minutesBetween('17:00', clockOutTime));
}

export function defaultAttendanceSchedule(date: string): AttendanceSchedule {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return { startTime: '', endTime: '', scheduledMinutes: 0, paidFreeMinutes: 0, label: 'Company closed' };
  return {
    startTime: '08:00',
    endTime: '17:00',
    scheduledMinutes: 480,
    paidFreeMinutes: 0,
    label: `${weekday === 6 ? 'Saturday' : 'Weekday'} · 08:00–17:00 · lunch 12:00–13:00`,
  };
}

export function applyHalfDaySchedule(
  schedule: AttendanceSchedule,
  date: string,
  weekday: number | null | undefined,
  workedHours: number | undefined,
  _paidFreeHours: number | undefined,
  effectiveFrom?: string | null,
  offPeriod: HalfDayOffPeriod = 'afternoon',
) {
  const dateWeekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday == null || weekday !== dateWeekday || (effectiveFrom && date < effectiveFrom)) return schedule;
  const workedMinutesValue = Math.max(0, Math.round(Number(workedHours ?? 0) * 60));
  if (!workedMinutesValue) return schedule;

  const normalStart = schedule.startTime ? Number(schedule.startTime.slice(0, 2)) * 60 + Number(schedule.startTime.slice(3, 5)) : 8 * 60;
  const normalEnd = schedule.endTime ? Number(schedule.endTime.slice(0, 2)) * 60 + Number(schedule.endTime.slice(3, 5)) : 17 * 60;
  const workStart = offPeriod === 'morning' ? Math.max(normalStart, normalEnd - workedMinutesValue) : normalStart;
  const workEnd = offPeriod === 'morning' ? normalEnd : Math.min(normalEnd, normalStart + workedMinutesValue);
  const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const placementLabel = offPeriod === 'morning' ? 'work last part of day' : 'work first part of day';

  return {
    ...schedule,
    startTime: time(workStart),
    endTime: time(workEnd),
    scheduledMinutes: workedMinutesValue,
    paidFreeMinutes: 0,
    label: `Weekly partial day · ${placementLabel} · ${time(workStart)}–${time(workEnd)} · ${roundHours(workedMinutesValue)} worked`,
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

export function hasAttendanceTimeChange(schedule: AttendanceSchedule, draft: Pick<AttendanceDayDraft, 'clockInTime' | 'clockOutTime' | 'breakMinutes'>) {
  return draft.clockInTime !== schedule.startTime
    || draft.clockOutTime !== schedule.endTime
    || draft.breakMinutes !== scheduledBreakMinutes(schedule);
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
  adjacentEntries?: EmployeeTimesheetEntry[];
  nextScheduledStartTime?: string;
}) {
  const { employee, date, schedule, draft, existingEntry, existingAbsence, updatedByUserId, updatedByName } = input;
  const now = new Date().toISOString();
  const scheduledHours = roundHours(schedule.scheduledMinutes);
  const scheduledPaidFreeMinutes = Math.max(0, Math.round(schedule.paidFreeMinutes));
  const scheduledBreakMinutesValue = scheduledBreakMinutes(schedule);
  const exceptionStatus = draft.status === 'Sick' || draft.status === 'Vacation' || draft.status === 'Absent';
  const workedStatus = draft.status === 'Present' || draft.status === 'Late';
  const workOrderAttendanceSegments = existingEntry?.workOrderAttendanceSegments ?? [];
  const enhanced = Boolean(draft.workIntervals?.length || draft.overtimePayAllocations !== undefined || existingEntry?.workIntervals?.length || existingEntry?.overtimePayAllocations !== undefined);
  const workIntervals = draft.workIntervals?.length ? normalizeAttendanceIntervals(draft.workIntervals).map(({ start: _start, end: _end, ...row }) => row) : undefined;
  const ratesOnly = Boolean(existingEntry && JSON.stringify(workIntervals) === JSON.stringify(existingEntry.workIntervals)
    && draft.overtimePayAllocations !== undefined
    && draft.clockInTime === (existingEntry.clockInTime ?? schedule.startTime)
    && draft.clockOutTime === (existingEntry.clockOutTime ?? schedule.endTime)
    && draft.breakMinutes === (existingEntry.breakMinutes ?? scheduledBreakMinutesValue)
    && draft.status === (existingEntry.attendanceStatus ?? statusFromRecords(existingEntry, undefined, schedule.scheduledMinutes))
    && draft.notes.trim() === (existingEntry.notes ?? '').trim());
  if (existingEntry?.workIntervals?.length && !workIntervals) throw new Error('Keep the recorded work intervals. Edit them explicitly instead of removing split mode.');
  if (enhanced && existingAbsence?.active !== false && existingAbsence) throw new Error('Resolve the active absence before recording worked intervals or overtime rates.');
  if (enhanced && !workedStatus) throw new Error('Work intervals and overtime rates require Present or Late status.');
  if (enhanced && (!updatedByUserId || !draft.changeReason?.trim())) throw new Error('Enter a reason for this attendance or overtime-rate change.');

  if (workedStatus && schedule.scheduledMinutes > 0 && !workIntervals && !ratesOnly) {
    if (!draft.clockInTime || !draft.clockOutTime) throw new Error('Clock In and Clock Out are required for a worked attendance day.');
    if (!hasValidWorkedTimeRange(draft.clockInTime, draft.clockOutTime)) throw new Error('Clock Out must be later than Clock In.');
  }

  const hasBaseAttendance = Boolean(workIntervals) || hasValidWorkedTimeRange(draft.clockInTime, draft.clockOutTime);
  const variance = calculateAttendanceVarianceWithWorkSegments({
    workDate: date,
    schedule,
    clockInTime: draft.clockInTime,
    clockOutTime: draft.clockOutTime,
    breakMinutes: draft.breakMinutes,
    workSegments: workOrderAttendanceSegments,
    workIntervals,
  });
  const attendanceExceptions = ratesOnly ? existingEntry?.attendanceExceptions ?? [] : workedStatus
    ? classifyAttendanceExceptions(variance, draft.attendanceExceptionClassifications)
    : [];
  const partialTotals = attendanceExceptionTotals(attendanceExceptions);
  const existingOvertimeMinutes = Math.max(
    0,
    Math.round(Number(existingEntry?.overtimeMinutes) || Math.round((Number(existingEntry?.overtimeHours) || 0) * 60)),
  );
  const preserveUnknownLegacyOvertime = !hasBaseAttendance && !workOrderAttendanceSegments.length && existingOvertimeMinutes > 0;

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
  const overtimeMinutesValue = ratesOnly || preserveUnknownLegacyOvertime ? existingOvertimeMinutes : variance.overtimeMinutes;
  const overtimePayAllocations = draft.overtimePayAllocations === undefined
    ? workIntervals && overtimeMinutesValue === 0 ? [] : existingEntry?.overtimePayAllocations
    : validateOvertimePayAllocations(draft.overtimePayAllocations, overtimeMinutesValue);
  if (enhanced && overtimePayAllocations !== undefined) validateOvertimePayAllocations(overtimePayAllocations, overtimeMinutesValue);
  if (workIntervals && overtimeMinutesValue > 0 && !overtimePayAllocations) throw new Error('Choose how to pay the calculated overtime.');

  let entry: EmployeeTimesheetEntry = {
    ...existingEntry,
    id: existingEntry?.id ?? `${employee.id}_${date}`,
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
    workedMinutes: variance.workedMinutes,
    attendanceExceptions,
    workOrderAttendanceSegments,
    ...(workIntervals ? { workIntervals } : {}),
    ...(overtimePayAllocations !== undefined ? { overtimePayAllocations } : {}),
    overtimeCalculationSource: workOrderAttendanceSegments.length ? 'attendance_authority_with_work_segments' : 'attendance_authority',
    overtimeReconciliationRequired: preserveUnknownLegacyOvertime,
    scheduledStartTime: schedule.startTime || undefined,
    scheduledEndTime: schedule.endTime || undefined,
    scheduledBreakMinutes: scheduledBreakMinutesValue,
    scheduledPaidFreeMinutes,
    createdAt: existingEntry?.createdAt ?? now,
    updatedAt: now,
    updatedByUserId,
    updatedByName,
  };
  if (ratesOnly) entry = { ...existingEntry!, overtimePayAllocations, updatedAt: now, updatedByUserId, updatedByName };

  if (enhanced || (workedStatus && input.adjacentEntries !== undefined)) {
    const reason = draft.changeReason?.trim() || 'Attendance update';
    const adjacent = (input.adjacentEntries ?? []).filter((row) => row.employeeId === employee.id && Math.abs(Date.parse(row.date) - Date.parse(date)) <= 86400000 && row.id !== entry.id);
    if (adjacent.some((row) => row.date === date)) throw new Error('Multiple records exist for this employee and date. Review them before saving.');
    const previousDate = new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const nextDate = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const readIds = [...adjacent.map((row) => row.id), `${employee.id}_${previousDate}`, `${employee.id}_${nextDate}`];
    const comparison = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
    const snapshot = (value: EmployeeTimesheetEntry) => {
      const { attendanceHistory: _history, ...rest } = value;
      return rest as Record<string, unknown>;
    };
    const comparable = (value: EmployeeTimesheetEntry) => {
      const { createdAt: _created, updatedAt: _updated, attendanceChangeReason: _reason, ...rest } = snapshot(value);
      return comparison(rest);
    };
    const saved = await mutateFirestoreDocumentWithReads<EmployeeTimesheetEntry>('employeeTimesheets', entry.id, readIds, (current, records) => {
      if (current && comparable(current) === comparable(entry) && current.attendanceChangeReason === reason) return null;
      if (comparison(current) !== comparison(existingEntry ?? null)) throw new Error('This attendance record changed. Refresh and review the latest values before saving.');
      const intervalRows = workIntervals ?? [{ startTime: draft.clockInTime, endTime: draft.clockOutTime, startDayOffset: 0, endDayOffset: 0, breakMinutes: draft.breakMinutes }];
      const normalized = ratesOnly ? [] : normalizeAttendanceIntervals(intervalRows);
      const nextStart = input.nextScheduledStartTime;
      if (normalized.some((row) => row.endDayOffset && nextStart && row.end > 1440 + Number(nextStart.slice(0, 2)) * 60 + Number(nextStart.slice(3, 5)))) throw new Error('This interval overlaps the next scheduled workday. Record that day separately.');
      for (const other of Object.values(records)) {
        if (!other || other.id === entry.id) continue;
        if (other.employeeId !== employee.id) throw new Error('Unexpected employee identity in adjacent attendance.');
        const otherWindows = attendanceWorkWindows(other, date);
        if (otherWindows.some(([start, end]) => normalized.some((n) => start < n.end && end > n.start))) throw new Error('These hours overlap an existing attendance record on an adjacent date.');
      }
      const history = [...(current?.attendanceHistory ?? []), { id: `${updatedByUserId}-${now}`, at: now, actorId: updatedByUserId!, actorName: updatedByName ?? updatedByUserId!, reason, before: current ? snapshot(current) : null, after: snapshot(entry) }];
      if (comparison(history).length > 700000) throw new Error('Attendance history is too large to extend safely. No history has been removed.');
      // Masked fields: unknown fields are never replaced or removed. The old
      // record is retained verbatim in history before an operator's explicit edit.
      const changedFields = Object.fromEntries(Object.entries(entry).filter(([key, value]) => key !== 'id' && value !== undefined && comparison((current as unknown as Record<string, unknown> | null)?.[key]) !== comparison(value)));
      return { ...changedFields, attendanceHistory: history, attendanceChangeReason: reason };
    });
    if (enhanced) return saved;
    entry = saved;
  } else await saveFirestoreDocument('employeeTimesheets', entry);

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
