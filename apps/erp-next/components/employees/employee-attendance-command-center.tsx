'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  canonicalVanId,
  loadCanonicalOperationsState,
  staffDisplayName,
  type CanonicalOperationsState,
  type CanonicalStaffProfile,
} from '@/lib/canonical-operations';
import {
  ATTENDANCE_STATUS_LABELS,
  absenceForDate,
  applyHalfDaySchedule,
  dateKey,
  defaultAttendanceSchedule,
  loadEmployeeAttendanceState,
  overtimeMinutesAfterFive,
  payrollPeriodBounds,
  payrollSettingsForStaff,
  saveAttendanceDay,
  saveSalaryAdvance,
  statusFromRecords,
  timesheetForDate,
  type AttendanceDayDraft,
  type AttendanceSchedule,
  type AttendanceStatus,
  type EmployeeAttendanceState,
  type EmployeeSalaryAdvance,
  type SalaryAdvanceMethod,
} from '@/lib/employee-attendance';
import styles from './employee-attendance-command-center.module.css';

const STATUS_OPTIONS = Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type WorkspaceTab = 'overview' | 'calendar' | 'advances';
type IconName = 'clock' | 'timer' | 'heart' | 'ban' | 'vacation' | 'wallet' | 'calendar' | 'user' | 'bolt' | 'briefcase';

type EmployeePeriodSummary = {
  employee: CanonicalStaffProfile;
  vanLabel: string;
  scheduled: number;
  regular: number;
  workedMinutes: number;
  overtime: number;
  ao: number;
  vacation: number;
  nwnp: number;
  paidFree: number;
  lateMinutes: number;
  advances: number;
  recordedDays: number;
};

type CalendarCell = { date: string; inMonth: boolean };

function monthKey(date: string) { return date.slice(0, 7); }
function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}
function shiftDateMonth(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00Z`);
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 15, 12));
  return shifted.toISOString().slice(0, 10);
}
function monthLabel(value: string) {
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-AW', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function shortDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function periodLabel(start: string, end: string) { return `${shortDate(start)} – ${shortDate(end)}`; }
function calendarDays(value: string): CalendarCell[] {
  const [year, month] = value.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + index);
    const date = current.toISOString().slice(0, 10);
    return { date, inMonth: current.getUTCMonth() === month - 1 };
  });
}
function minutesFromTimes(start?: string, end?: string) {
  if (!start || !end) return undefined;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return undefined;
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}
function hoursAndMinutes(minutes: number | undefined) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(value / 60);
  const m = value % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h 00m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
function hours(value: number) { return hoursAndMinutes(Math.round((Number(value) || 0) * 60)); }
function signedHours(minutes: number) {
  const sign = minutes < 0 ? '−' : '+';
  return `${sign}${hoursAndMinutes(Math.abs(minutes))}`;
}
function money(value: number) { return `Afl. ${(Number(value) || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '—';
}
function statusTone(status: AttendanceStatus | null) { return status ?? 'No record'; }
function statusShort(status: AttendanceStatus | null) {
  if (!status) return 'No record';
  if (status === 'Sick') return 'AO / Sick';
  if (status === 'Absent') return 'NWNP';
  return ATTENDANCE_STATUS_LABELS[status];
}

function Icon({ name }: { name: IconName }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.2 2"/></svg>;
  if (name === 'timer') return <svg {...common}><path d="M9 3h6M12 3v3"/><circle cx="12" cy="14" r="7"/><path d="M12 10v4l2.4 1.5"/></svg>;
  if (name === 'heart') return <svg {...common}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M9 12h2l1-2 1.5 4 1-2H17"/></svg>;
  if (name === 'ban') return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="m7 17 10-10"/></svg>;
  if (name === 'vacation') return <svg {...common}><path d="M4 18h16M7 18c.5-5 2-8 5-11 3 3 4.5 6 5 11M12 7c-2-2-4-2.5-6-1M12 7c2-2 4-2.5 6-1M12 7V4"/></svg>;
  if (name === 'wallet') return <svg {...common}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v14H6.5A2.5 2.5 0 0 1 4 16.5v-9Z"/><path d="M16 10h4v5h-4a2.5 2.5 0 0 1 0-5Z"/></svg>;
  if (name === 'calendar') return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>;
  if (name === 'user') return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>;
  if (name === 'bolt') return <svg {...common}><path d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z"/></svg>;
  return <svg {...common}><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2M4 12h16"/></svg>;
}

export function EmployeeAttendanceCommandCenter() {
  const { principal } = useAuth();
  const canManageSensitiveAttendance = principal.role === 'super_admin' || principal.capabilities.has('payroll_sensitive.view');
  const today = dateKey(new Date());
  const [operations, setOperations] = useState<CanonicalOperationsState | null>(null);
  const [attendance, setAttendance] = useState<EmployeeAttendanceState>({ payrollSettings: [], timesheets: [], advances: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [periodAnchor, setPeriodAnchor] = useState(today);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(monthKey(today));
  const [draft, setDraft] = useState<AttendanceDayDraft | null>(null);
  const [advanceDraft, setAdvanceDraft] = useState({ employeeId: '', date: today, amount: '', method: 'Bank Transfer' as SalaryAdvanceMethod, reference: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const canonical = await loadCanonicalOperationsState();
      setOperations(canonical);
      const first = canonical.staffProfiles.find((profile) => profile.active !== false) ?? canonical.staffProfiles[0];
      setSelectedEmployeeId((current) => current || first?.id || '');
      setAdvanceDraft((current) => ({ ...current, employeeId: current.employeeId || first?.id || '' }));
      if (canManageSensitiveAttendance) {
        try { setAttendance(await loadEmployeeAttendanceState()); }
        catch (cause) { setError(`Attendance/payroll records are restricted or unavailable: ${errorText(cause)}`); }
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }, [canManageSensitiveAttendance]);

  useEffect(() => { void load(); }, [load]);

  const employees = useMemo(() => (operations?.staffProfiles ?? []).filter((profile) => profile.active !== false), [operations]);
  const selectedEmployee = employees.find((profile) => profile.id === selectedEmployeeId) ?? employees[0] ?? null;
  const period = useMemo(() => payrollPeriodBounds(periodAnchor), [periodAnchor]);
  const monthCells = useMemo(() => calendarDays(month), [month]);

  const employeeVan = useCallback((profile: CanonicalStaffProfile | null) => {
    if (!operations || !profile) return null;
    return operations.vans.find((van) => van.responsibleStaffId === profile.id || van.regularHelperId === profile.id) ?? null;
  }, [operations]);

  const scheduleForDate = useCallback((profile: CanonicalStaffProfile, date: string): AttendanceSchedule => {
    let schedule = defaultAttendanceSchedule(date);
    const settings = payrollSettingsForStaff(attendance.payrollSettings, profile.id);
    const van = employeeVan(profile);
    const vanId = van ? canonicalVanId(van.id, operations?.vans ?? []) : '';
    const halfDay = operations?.vanHalfDaySchedules.find((rule) => vanId && canonicalVanId(rule.vanId, operations.vans) === vanId);
    const isTechnical = profile.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '');
    if (isTechnical && halfDay?.weekday !== undefined) {
      const ruleMinutes = minutesFromTimes(halfDay.workdayStart ?? schedule.startTime, halfDay.workdayEnd);
      schedule = applyHalfDaySchedule(schedule, date, halfDay.weekday, ruleMinutes ? ruleMinutes / 60 : settings?.halfDayWorkedHours ?? 5, settings?.halfDayPaidFreeHours ?? 3, settings?.halfDayEffectiveFrom ?? '2026-08-01');
    } else if (settings?.weeklyHalfDayWeekday !== undefined) {
      schedule = applyHalfDaySchedule(schedule, date, settings.weeklyHalfDayWeekday, settings.halfDayWorkedHours, settings.halfDayPaidFreeHours, settings.halfDayEffectiveFrom);
    }
    return schedule;
  }, [attendance.payrollSettings, employeeVan, operations]);

  const recordsFor = useCallback((profile: CanonicalStaffProfile, date: string) => {
    const schedule = scheduleForDate(profile, date);
    const absence = absenceForDate(operations?.staffAbsences ?? [], profile.id, date);
    const entry = timesheetForDate(attendance.timesheets, profile.id, date);
    const status = statusFromRecords(entry, absence, schedule.scheduledMinutes);
    return { schedule, absence, entry, status };
  }, [attendance.timesheets, operations?.staffAbsences, scheduleForDate]);

  const buildDraft = useCallback((profile: CanonicalStaffProfile, date: string) => {
    const record = recordsFor(profile, date);
    const defaultBreak = record.schedule.scheduledMinutes >= 480 ? 60 : 0;
    const status = record.status ?? (record.schedule.scheduledMinutes ? 'Present' : 'Day Off');
    const exceptionHours = status === 'Sick' ? record.entry?.aoHours : status === 'Vacation' ? record.entry?.vacationHours : status === 'Absent' ? record.entry?.noWorkNoPayHours : undefined;
    return {
      status,
      clockInTime: record.entry?.clockInTime ?? record.schedule.startTime,
      clockOutTime: record.entry?.clockOutTime ?? record.schedule.endTime,
      breakMinutes: record.entry?.breakMinutes ?? defaultBreak,
      overtimeMinutes: record.entry?.overtimeMinutes ?? Math.round((record.entry?.overtimeHours ?? 0) * 60),
      exceptionHours: exceptionHours ?? (['Sick', 'Vacation', 'Absent'].includes(status) ? record.schedule.scheduledMinutes / 60 : undefined),
      notes: record.entry?.notes ?? record.absence?.notes ?? '',
    } satisfies AttendanceDayDraft;
  }, [recordsFor]);

  useEffect(() => { if (selectedEmployee) setDraft(buildDraft(selectedEmployee, selectedDate)); }, [buildDraft, selectedDate, selectedEmployee]);

  const periodSummaries = useMemo<EmployeePeriodSummary[]>(() => employees.map((employee) => {
    const entries = attendance.timesheets.filter((entry) => entry.employeeId === employee.id && entry.payrollPeriodId === period.id);
    const advances = (attendance.advances ?? []).filter((advance) => advance.employeeId === employee.id && advance.payrollPeriodId === period.id);
    const van = employeeVan(employee);
    return {
      employee,
      vanLabel: van?.name ?? van?.id ?? employee.primaryVanId ?? 'UNASSIGNED',
      scheduled: entries.reduce((sum, entry) => sum + (entry.scheduledWorkHours ?? 0), 0),
      regular: entries.reduce((sum, entry) => sum + (entry.regularHours ?? 0), 0),
      workedMinutes: entries.reduce((sum, entry) => sum + (entry.workedMinutes ?? 0), 0),
      overtime: entries.reduce((sum, entry) => sum + (entry.overtimeHours ?? 0), 0),
      ao: entries.reduce((sum, entry) => sum + (entry.aoHours ?? 0), 0),
      vacation: entries.reduce((sum, entry) => sum + (entry.vacationHours ?? 0), 0),
      nwnp: entries.reduce((sum, entry) => sum + (entry.noWorkNoPayHours ?? 0), 0),
      paidFree: entries.reduce((sum, entry) => sum + (entry.paidFreeHours ?? 0), 0),
      lateMinutes: entries.reduce((sum, entry) => sum + (entry.lateMinutes ?? 0), 0),
      advances: advances.reduce((sum, advance) => sum + (advance.amount ?? 0), 0),
      recordedDays: entries.length,
    };
  }), [attendance.advances, attendance.timesheets, employeeVan, employees, period.id]);

  const totals = useMemo(() => periodSummaries.reduce((acc, row) => ({
    regular: acc.regular + row.regular,
    overtime: acc.overtime + row.overtime,
    ao: acc.ao + row.ao,
    vacation: acc.vacation + row.vacation,
    nwnp: acc.nwnp + row.nwnp,
    paidFree: acc.paidFree + row.paidFree,
    advances: acc.advances + row.advances,
  }), { regular: 0, overtime: 0, ao: 0, vacation: 0, nwnp: 0, paidFree: 0, advances: 0 }), [periodSummaries]);

  const periodAdvances = useMemo(() => (attendance.advances ?? []).filter((advance) => advance.payrollPeriodId === period.id).sort((a, b) => b.date.localeCompare(a.date)), [attendance.advances, period.id]);
  const selectedSummary = periodSummaries.find((summary) => summary.employee.id === selectedEmployee?.id);
  const selectedRecord = selectedEmployee ? recordsFor(selectedEmployee, selectedDate) : null;
  const suggestedOvertime = draft ? overtimeMinutesAfterFive(draft.clockOutTime) : 0;
  const selectedWorkedMinutes = draft ? Math.max(0, (minutesFromTimes(draft.clockInTime, draft.clockOutTime) ?? 0) - draft.breakMinutes) : 0;
  const selectedExceptionHours = Math.max(0, Number(draft?.exceptionHours) || 0);
  const selectedRegularHours = selectedRecord && draft ? Math.max(0, selectedRecord.schedule.scheduledMinutes / 60 - (['Sick', 'Vacation', 'Absent'].includes(draft.status) ? selectedExceptionHours : 0)) : 0;
  const balanceMinutes = (selectedSummary?.workedMinutes ?? 0) - Math.round((selectedSummary?.scheduled ?? 0) * 60);
  const selectedAbsenceRanges = useMemo(() => (operations?.staffAbsences ?? []).filter((item) => item.staffId === selectedEmployee?.id && item.active !== false).sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? ''))).slice(0, 4), [operations?.staffAbsences, selectedEmployee?.id]);

  function exportAccountingCsv() {
    const headers = ['Employee', 'Role', 'Van / Team', 'Scheduled Hours', 'Regular Hours', 'Worked Clock Hours', 'Overtime Hours', 'AO Hours', 'Vacation Hours', 'NWNP Hours', 'Paid Free Hours', 'Salary Advances Afl', 'Late Minutes', 'Recorded Days'];
    const rows = periodSummaries.map((summary) => [staffDisplayName(summary.employee), summary.employee.role ?? '', summary.vanLabel, summary.scheduled.toFixed(2), summary.regular.toFixed(2), (summary.workedMinutes / 60).toFixed(2), summary.overtime.toFixed(2), summary.ao.toFixed(2), summary.vacation.toFixed(2), summary.nwnp.toFixed(2), summary.paidFree.toFixed(2), summary.advances.toFixed(2), String(summary.lateMinutes), String(summary.recordedDays)]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `DEMAC-payroll-inputs-${period.start}-to-${period.end}.csv`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  async function saveDay() {
    if (!selectedEmployee || !draft || !selectedRecord || !canManageSensitiveAttendance) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveAttendanceDay({ employee: selectedEmployee, date: selectedDate, schedule: selectedRecord.schedule, draft, existingEntry: selectedRecord.entry, existingAbsence: selectedRecord.absence, updatedByUserId: principal.userId, updatedByName: principal.displayName });
      setAttendance((current) => ({ ...current, timesheets: [...current.timesheets.filter((entry) => entry.id !== saved.id), saved] }));
      setMessage('Daily attendance record saved. Payroll inputs and operational availability are synchronized.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function recordAdvance() {
    if (!canManageSensitiveAttendance) return;
    const employee = employees.find((profile) => profile.id === advanceDraft.employeeId);
    if (!employee) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveSalaryAdvance({ employee, date: advanceDraft.date, amount: Number(advanceDraft.amount), method: advanceDraft.method, reference: advanceDraft.reference, notes: advanceDraft.notes, recordedByUserId: principal.userId, recordedByName: principal.displayName });
      setAttendance((current) => ({ ...current, advances: [...(current.advances ?? []), saved] }));
      setAdvanceDraft((current) => ({ ...current, amount: '', reference: '', notes: '' }));
      setPeriodAnchor(advanceDraft.date);
      setMessage('Salary advance recorded. No automatic payroll deduction was applied.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className={styles.loadingCard}>Loading Attendance & Timekeeping…</div>;

  const calendarWorkspace = (
    <>
      <section className={styles.employeeStrip}>
        <div className={styles.employeeIdentity}>
          <div className={styles.avatarLarge}>{selectedEmployee ? initials(staffDisplayName(selectedEmployee)) : '—'}</div>
          <div className={styles.employeeIdentityCopy}>
            <div className={styles.employeeNameLine}>
              <strong>{selectedEmployee ? staffDisplayName(selectedEmployee) : 'No employee selected'}</strong>
              <span className={styles.activeStatus}><i />Active</span>
            </div>
            <div className={styles.employeeSubline}>{selectedEmployee?.role ?? selectedEmployee?.employeeType ?? 'Employee'} · {selectedSummary?.vanLabel ?? 'UNASSIGNED'}</div>
            <select className={styles.changeEmployee} value={selectedEmployee?.id ?? ''} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)} · {employee.role ?? employee.employeeType ?? 'Employee'}</option>)}
            </select>
          </div>
        </div>
        <MiniStat label="Scheduled" value={hours(selectedSummary?.scheduled ?? 0)} />
        <MiniStat label="Clocked" value={hoursAndMinutes(selectedSummary?.workedMinutes ?? 0)} />
        <MiniStat label="Regular" value={hours(selectedSummary?.regular ?? 0)} />
        <MiniStat label="Overtime" value={hours(selectedSummary?.overtime ?? 0)} />
        <MiniStat label="Balance" value={signedHours(balanceMinutes)} tone={balanceMinutes < 0 ? 'danger' : 'positive'} />
        <button type="button" className={styles.profileButton}><Icon name="user" />View Profile</button>
      </section>

      <div className={styles.mainGrid}>
        <section className={styles.calendarCard}>
          <div className={styles.calendarToolbar}>
            <h2>{monthLabel(month)}</h2>
            <div className={styles.calendarActions}>
              <button className={styles.squareButton} type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} aria-label="Previous month">‹</button>
              <button className={styles.ghostButton} type="button" onClick={() => { setMonth(monthKey(today)); setSelectedDate(today); }}>Today</button>
              <span className={styles.viewBadge}>Month⌄</span>
              <button className={styles.squareButton} type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} aria-label="Next month">›</button>
            </div>
          </div>
          <div className={styles.weekHeader}>{WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}</div>
          <div className={styles.calendarGrid}>
            {monthCells.map(({ date, inMonth }) => {
              const record = selectedEmployee ? recordsFor(selectedEmployee, date) : null;
              const entryMinutes = record?.entry?.workedMinutes ?? Math.round((record?.entry?.regularHours ?? 0) * 60);
              return (
                <button key={date} type="button" className={`${styles.dayButton} ${!inMonth ? styles.dayOutside : ''} ${date === selectedDate ? styles.daySelected : ''}`} onClick={() => { setSelectedDate(date); if (!inMonth) setMonth(monthKey(date)); }}>
                  <span className={styles.dayNumber}>{Number(date.slice(-2))}</span>
                  {record?.status ? <span className={styles.dayState} data-tone={statusTone(record.status)}><i />{record.status === 'Present' && entryMinutes ? hoursAndMinutes(entryMinutes) : statusShort(record.status)}</span> : <span className={styles.dayNoRecord}>No record</span>}
                </button>
              );
            })}
          </div>
          <div className={styles.calendarLegend}>
            <Legend tone="present">Present</Legend><Legend tone="late">Late</Legend><Legend tone="sick">AO / Sick</Legend><Legend tone="vacation">Vacation</Legend><Legend tone="none">No record</Legend>
            <span className={styles.historyLink}><Icon name="calendar" />Absence History</span>
          </div>
        </section>

        <aside className={styles.rightRail}>
          <section className={styles.dailyCard}>
            <div className={styles.dailyHeader}>
              <div><h2>Daily Record</h2><span>Selected Date</span><strong><Icon name="calendar" />{formatDate(selectedDate)}</strong><small>{selectedRecord?.schedule.label ?? 'No configured schedule'}</small></div>
              <span className={styles.statusChip} data-tone={draft?.status ?? 'Present'}>{draft ? statusShort(draft.status) : 'No record'}⌄</span>
            </div>
            {draft && selectedRecord ? (
              <div className={styles.dailyForm}>
                <Field label="Status" full><select className={styles.control} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as AttendanceStatus, exceptionHours: ['Sick', 'Vacation', 'Absent'].includes(event.target.value) ? (draft.exceptionHours ?? selectedRecord.schedule.scheduledMinutes / 60) : undefined })}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_LABELS[status]}</option>)}</select></Field>
                {['Sick', 'Vacation', 'Absent'].includes(draft.status) ? <Field label="Exception Hours" full><input className={styles.control} type="number" min="0" max={selectedRecord.schedule.scheduledMinutes / 60} step="0.25" value={draft.exceptionHours ?? ''} onChange={(event) => setDraft({ ...draft, exceptionHours: Number(event.target.value) })} /></Field> : null}
                <Field label="Clock In"><input className={styles.control} type="time" value={draft.clockInTime} onChange={(event) => setDraft({ ...draft, clockInTime: event.target.value })} /></Field>
                <Field label="Clock Out"><input className={styles.control} type="time" value={draft.clockOutTime} onChange={(event) => setDraft({ ...draft, clockOutTime: event.target.value })} /></Field>
                <Field label="Break Minutes"><input className={styles.control} type="number" min="0" step="5" value={draft.breakMinutes} onChange={(event) => setDraft({ ...draft, breakMinutes: Number(event.target.value) })} /></Field>
                <Field label="Overtime Minutes"><input className={styles.control} type="number" min="0" step="5" value={draft.overtimeMinutes} onChange={(event) => setDraft({ ...draft, overtimeMinutes: Number(event.target.value) })} /></Field>
                {suggestedOvertime !== draft.overtimeMinutes ? <button type="button" className={styles.overtimeSuggestion} onClick={() => setDraft({ ...draft, overtimeMinutes: suggestedOvertime })}>Use {hoursAndMinutes(suggestedOvertime)} suggested overtime</button> : null}
                <Field label="Notes" full><textarea className={`${styles.control} ${styles.notes}`} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Add notes for this day…" /></Field>
                <div className={styles.dailySummary}>
                  <SummaryRow icon="clock" label="Scheduled" value={hours(selectedRecord.schedule.scheduledMinutes / 60)} tone="blue" />
                  <SummaryRow icon="vacation" label="Paid Free" value={hours(selectedRecord.schedule.paidFreeMinutes / 60)} tone="green" />
                  <SummaryRow icon="timer" label="Existing Late" value={hoursAndMinutes(selectedRecord.entry?.lateMinutes ?? 0)} tone="orange" />
                  <SummaryRow icon="briefcase" label="Existing Worked" value={hoursAndMinutes(selectedWorkedMinutes)} tone="blue" />
                  {['Sick', 'Vacation', 'Absent'].includes(draft.status) ? <SummaryRow icon="heart" label="Regular Input" value={hours(selectedRegularHours)} tone="pink" /> : null}
                </div>
                <button className={styles.saveButton} type="button" disabled={busy || !canManageSensitiveAttendance} onClick={() => void saveDay()}>{busy ? 'Saving…' : 'Save Daily Record'}</button>
              </div>
            ) : <div className={styles.empty}>Select an employee and date to record attendance.</div>}
          </section>

          <section className={styles.rangesCard}>
            <div className={styles.rangesIcon}><Icon name="calendar" /></div>
            <div><h3>Recent / Scheduled Ranges</h3>{selectedAbsenceRanges.length ? selectedAbsenceRanges.map((range) => <p key={range.id}><strong>{range.reason ?? 'Absence'}</strong> · {range.fromDate ?? '—'}{range.toDate && range.toDate !== range.fromDate ? ` → ${range.toDate}` : ''}</p>) : <p>No absence ranges recorded.</p>}</div>
          </section>
        </aside>
      </div>
    </>
  );

  return (
    <div className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div className={styles.headerText}>
          <div className={styles.breadcrumb}><span>Workforce</span><b>›</b><span>Attendance</span><b>›</b><span>Overview</span></div>
          <h1>Attendance &amp; Timekeeping</h1>
          <p>Monitor attendance, manage records, and maintain accurate timekeeping.</p>
        </div>
        <div className={styles.headerActions}>
          <details className={styles.quickActions}><summary><Icon name="bolt" />Quick actions <span>⌄</span></summary><div className={styles.quickMenu}><button type="button" onClick={() => void load()}>Refresh data</button><button type="button" onClick={exportAccountingCsv} disabled={!canManageSensitiveAttendance}>Export accounting CSV</button><button type="button" onClick={() => setTab('advances')} disabled={!canManageSensitiveAttendance}>Record salary advance</button></div></details>
          <div className={styles.periodSelector}><Icon name="calendar" /><div><span>Payroll Period</span><strong>{periodLabel(period.start, period.end)}</strong></div><button type="button" onClick={() => setPeriodAnchor((value) => shiftDateMonth(value, -1))}>‹</button><button type="button" onClick={() => setPeriodAnchor((value) => shiftDateMonth(value, 1))}>›</button></div>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Attendance sections">
        <button type="button" className={tab === 'overview' ? styles.activeTab : ''} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={tab === 'calendar' ? styles.activeTab : ''} onClick={() => setTab('calendar')}>Employee Calendar</button>
        <button type="button" className={tab === 'advances' ? styles.activeTab : ''} onClick={() => setTab('advances')}>Salary Advances</button>
      </nav>

      {!canManageSensitiveAttendance ? <div className={styles.notice}>Payroll-sensitive details are protected. Your current role cannot read or edit employee payroll inputs.</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      <section className={styles.metricsGrid}>
        <Metric icon="clock" tone="blue" label="Regular Hours" value={hours(totals.regular)} sub="This payroll period" />
        <Metric icon="timer" tone="purple" label="Overtime" value={hours(totals.overtime)} sub="After 5:00 PM" />
        <Metric icon="heart" tone="pink" label="AO / Sick" value={hours(totals.ao)} sub="Full + partial hours" />
        <Metric icon="ban" tone="orange" label="No Work No Pay" value={hours(totals.nwnp)} sub="Unpaid exception hours" />
        <Metric icon="vacation" tone="green" label="Vacation / Paid Free" value={hours(totals.vacation + totals.paidFree)} sub={`Paid free ${hours(totals.paidFree)}`} />
        <Metric icon="wallet" tone="blue" label="Salary Advances" value={money(totals.advances)} sub={`${periodAdvances.length} record${periodAdvances.length === 1 ? '' : 's'} this period`} />
      </section>

      {tab === 'overview' || tab === 'calendar' ? calendarWorkspace : null}

      {tab === 'advances' ? (
        <div className={styles.advancesLayout}>
          <section className={styles.advanceLedger}>
            <div className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>Payroll input ledger</span><h2>Salary Advances</h2><p>Cash and bank-transfer advances tied to the selected payroll period.</p></div><span className={styles.totalPill}>{periodAdvances.length} records · {money(totals.advances)}</span></div>
            <div className={styles.tableWrap}><table className={styles.advanceTable}><thead><tr><th>Date</th><th>Employee</th><th>Method</th><th>Reference</th><th>Amount</th><th>Recorded by</th></tr></thead><tbody>{periodAdvances.map((advance: EmployeeSalaryAdvance) => <tr key={advance.id}><td>{shortDate(advance.date)}</td><td>{advance.employeeName}</td><td><span className={styles.methodPill}>{advance.method}</span></td><td>{advance.reference || '—'}</td><td><strong>{money(advance.amount)}</strong></td><td>{advance.recordedByName || '—'}</td></tr>)}</tbody></table></div>
            {!periodAdvances.length ? <div className={styles.empty}>No salary advances recorded for this payroll period.</div> : null}
          </section>
          <section className={styles.advanceFormCard}>
            <span className={styles.sectionEyebrow}>New payroll input</span><h2>Record Salary Advance</h2><p>This records the advance only; it does not apply an automatic deduction.</p>
            <div className={styles.dailyForm}>
              <Field label="Employee" full><select className={styles.control} value={advanceDraft.employeeId} onChange={(event) => setAdvanceDraft({ ...advanceDraft, employeeId: event.target.value })}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)} · {employee.role ?? employee.employeeType ?? 'Employee'}</option>)}</select></Field>
              <Field label="Date"><input className={styles.control} type="date" value={advanceDraft.date} onChange={(event) => setAdvanceDraft({ ...advanceDraft, date: event.target.value })} /></Field>
              <Field label="Amount (Afl.)"><input className={styles.control} type="number" min="0" step="0.01" value={advanceDraft.amount} onChange={(event) => setAdvanceDraft({ ...advanceDraft, amount: event.target.value })} /></Field>
              <Field label="Method"><select className={styles.control} value={advanceDraft.method} onChange={(event) => setAdvanceDraft({ ...advanceDraft, method: event.target.value as SalaryAdvanceMethod })}><option value="Bank Transfer">Bank Transfer</option><option value="Cash">Cash</option></select></Field>
              <Field label="Reference / Receipt"><input className={styles.control} value={advanceDraft.reference} onChange={(event) => setAdvanceDraft({ ...advanceDraft, reference: event.target.value })} placeholder="Optional reference" /></Field>
              <Field label="Notes" full><textarea className={`${styles.control} ${styles.notes}`} value={advanceDraft.notes} onChange={(event) => setAdvanceDraft({ ...advanceDraft, notes: event.target.value })} placeholder="Reason or internal note…" /></Field>
              <button className={styles.saveButton} type="button" disabled={busy || !canManageSensitiveAttendance || !advanceDraft.amount} onClick={() => void recordAdvance()}>{busy ? 'Saving…' : 'Record Advance'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ icon, tone, label, value, sub }: { icon: IconName; tone: string; label: string; value: string; sub: string }) {
  return <article className={styles.metricCard}><div className={styles.metricIcon} data-tone={tone}><Icon name={icon} /></div><div><span className={styles.metricLabel}>{label}</span><strong className={styles.metricValue}>{value}</strong><span className={styles.metricSub}>{sub}</span></div></article>;
}
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'positive' }) {
  return <div className={styles.miniStat}><span>{label}</span><strong className={tone ? styles[tone] : undefined}>{value}</strong><small>This period</small></div>;
}
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return <label className={`${styles.field} ${full ? styles.fieldFull : ''}`}><span>{label}</span>{children}</label>;
}
function Legend({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={styles.legendItem} data-tone={tone}><i />{children}</span>;
}
function SummaryRow({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone: string }) {
  return <div className={styles.summaryRow}><span className={styles.summaryIcon} data-tone={tone}><Icon name={icon} /></span><span>{label}</span><strong>{value}</strong></div>;
}
