'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

type EmployeePeriodSummary = {
  employee: CanonicalStaffProfile;
  vanLabel: string;
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

function monthKey(date: string) {
  return date.slice(0, 7);
}

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
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function shortDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function periodLabel(start: string, end: string) {
  return `${shortDate(start)} — ${shortDate(end)}`;
}

function calendarDays(value: string) {
  const [year, month] = value.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
  const totalDays = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= totalDays; day += 1) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
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
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function hours(value: number) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return `${rounded.toLocaleString('en-AW', { maximumFractionDigits: 2 })}h`;
}

function money(value: number) {
  return `Afl. ${(Number(value) || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '—';
}

function statusTone(status: AttendanceStatus | null) {
  return status ?? 'No record';
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
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(monthKey(today));
  const [draft, setDraft] = useState<AttendanceDayDraft | null>(null);
  const [advanceDraft, setAdvanceDraft] = useState({
    employeeId: '',
    date: today,
    amount: '',
    method: 'Bank Transfer' as SalaryAdvanceMethod,
    reference: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const canonical = await loadCanonicalOperationsState();
      setOperations(canonical);
      const firstEmployee = canonical.staffProfiles.find((profile) => profile.active !== false) ?? canonical.staffProfiles[0];
      setSelectedEmployeeId((current) => current || firstEmployee?.id || '');
      setAdvanceDraft((current) => ({ ...current, employeeId: current.employeeId || firstEmployee?.id || '' }));
      if (canManageSensitiveAttendance) {
        try {
          setAttendance(await loadEmployeeAttendanceState());
        } catch (cause) {
          setError(`Attendance/payroll records are restricted or unavailable: ${errorText(cause)}`);
        }
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [canManageSensitiveAttendance]);

  useEffect(() => { void load(); }, [load]);

  const employees = useMemo(
    () => (operations?.staffProfiles ?? []).filter((profile) => profile.active !== false),
    [operations],
  );
  const selectedEmployee = employees.find((profile) => profile.id === selectedEmployeeId) ?? employees[0] ?? null;
  const period = useMemo(() => payrollPeriodBounds(periodAnchor), [periodAnchor]);
  const monthCells = useMemo(() => calendarDays(month), [month]);

  const employeeVan = useCallback((profile: CanonicalStaffProfile | null) => {
    if (!operations || !profile) return null;
    return operations.vans.find((van) => van.responsibleStaffId === profile.id || van.regularHelperId === profile.id) ?? null;
  }, [operations]);

  const scheduleForDate = useCallback((profile: CanonicalStaffProfile, date: string): AttendanceSchedule => {
    let schedule = defaultAttendanceSchedule(date);
    const payrollSettings = payrollSettingsForStaff(attendance.payrollSettings, profile.id);
    const van = employeeVan(profile);
    const vanId = van ? canonicalVanId(van.id, operations?.vans ?? []) : '';
    const halfDay = operations?.vanHalfDaySchedules.find((rule) => vanId && canonicalVanId(rule.vanId, operations.vans) === vanId);
    const isTechnical = profile.employeeType === 'Técnico' || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '');

    if (isTechnical && halfDay?.weekday !== undefined) {
      const ruleMinutes = minutesFromTimes(halfDay.workdayStart ?? schedule.startTime, halfDay.workdayEnd);
      schedule = applyHalfDaySchedule(
        schedule,
        date,
        halfDay.weekday,
        ruleMinutes ? ruleMinutes / 60 : payrollSettings?.halfDayWorkedHours ?? 5,
        payrollSettings?.halfDayPaidFreeHours ?? 3,
        payrollSettings?.halfDayEffectiveFrom ?? '2026-08-01',
      );
    } else if (payrollSettings?.weeklyHalfDayWeekday !== undefined) {
      schedule = applyHalfDaySchedule(
        schedule,
        date,
        payrollSettings.weeklyHalfDayWeekday,
        payrollSettings.halfDayWorkedHours,
        payrollSettings.halfDayPaidFreeHours,
        payrollSettings.halfDayEffectiveFrom,
      );
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
    const exceptionHours = status === 'Sick'
      ? record.entry?.aoHours
      : status === 'Vacation'
        ? record.entry?.vacationHours
        : status === 'Absent'
          ? record.entry?.noWorkNoPayHours
          : undefined;
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

  useEffect(() => {
    if (selectedEmployee) setDraft(buildDraft(selectedEmployee, selectedDate));
  }, [buildDraft, selectedDate, selectedEmployee]);

  const periodSummaries = useMemo<EmployeePeriodSummary[]>(() => employees.map((employee) => {
    const entries = attendance.timesheets.filter((entry) => entry.employeeId === employee.id && entry.payrollPeriodId === period.id);
    const advances = (attendance.advances ?? []).filter((advance) => advance.employeeId === employee.id && advance.payrollPeriodId === period.id);
    const van = employeeVan(employee);
    return {
      employee,
      vanLabel: van?.name ?? van?.id ?? employee.primaryVanId ?? '—',
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

  const filteredSummaries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return periodSummaries;
    return periodSummaries.filter((summary) => [
      staffDisplayName(summary.employee), summary.employee.role, summary.employee.employeeType, summary.vanLabel,
    ].some((value) => (value ?? '').toLowerCase().includes(needle)));
  }, [periodSummaries, search]);

  const totals = useMemo(() => periodSummaries.reduce((acc, row) => ({
    regular: acc.regular + row.regular,
    workedMinutes: acc.workedMinutes + row.workedMinutes,
    overtime: acc.overtime + row.overtime,
    ao: acc.ao + row.ao,
    vacation: acc.vacation + row.vacation,
    nwnp: acc.nwnp + row.nwnp,
    paidFree: acc.paidFree + row.paidFree,
    advances: acc.advances + row.advances,
  }), { regular: 0, workedMinutes: 0, overtime: 0, ao: 0, vacation: 0, nwnp: 0, paidFree: 0, advances: 0 }), [periodSummaries]);

  const periodAdvances = useMemo(
    () => (attendance.advances ?? []).filter((advance) => advance.payrollPeriodId === period.id).sort((a, b) => b.date.localeCompare(a.date)),
    [attendance.advances, period.id],
  );

  const selectedRecord = selectedEmployee ? recordsFor(selectedEmployee, selectedDate) : null;
  const suggestedOvertime = draft ? overtimeMinutesAfterFive(draft.clockOutTime) : 0;
  const selectedWorkedMinutes = draft ? Math.max(0, (minutesFromTimes(draft.clockInTime, draft.clockOutTime) ?? 0) - draft.breakMinutes) : 0;
  const selectedExceptionHours = Math.max(0, Number(draft?.exceptionHours) || 0);
  const selectedRegularHours = selectedRecord && draft
    ? Math.max(0, selectedRecord.schedule.scheduledMinutes / 60 - (['Sick', 'Vacation', 'Absent'].includes(draft.status) ? selectedExceptionHours : 0))
    : 0;

  function openEmployee(employeeId: string) {
    setSelectedEmployeeId(employeeId);
    setTab('calendar');
    setMessage('');
  }

  function exportAccountingCsv() {
    const headers = ['Employee', 'Role', 'Van / Team', 'Regular Hours', 'Worked Clock Hours', 'Overtime Hours', 'AO Hours', 'Vacation Hours', 'NWNP Hours', 'Paid Free Hours', 'Salary Advances Afl', 'Late Minutes', 'Recorded Days'];
    const rows = periodSummaries.map((summary) => [
      staffDisplayName(summary.employee), summary.employee.role ?? '', summary.vanLabel,
      summary.regular.toFixed(2), (summary.workedMinutes / 60).toFixed(2), summary.overtime.toFixed(2),
      summary.ao.toFixed(2), summary.vacation.toFixed(2), summary.nwnp.toFixed(2), summary.paidFree.toFixed(2),
      summary.advances.toFixed(2), String(summary.lateMinutes), String(summary.recordedDays),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DEMAC-payroll-inputs-${period.start}-to-${period.end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function saveDay() {
    if (!selectedEmployee || !draft || !selectedRecord || !canManageSensitiveAttendance) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveAttendanceDay({
        employee: selectedEmployee,
        date: selectedDate,
        schedule: selectedRecord.schedule,
        draft,
        existingEntry: selectedRecord.entry,
        existingAbsence: selectedRecord.absence,
        updatedByUserId: principal.userId,
        updatedByName: principal.displayName,
      });
      setAttendance((current) => ({
        ...current,
        timesheets: [...current.timesheets.filter((entry) => entry.id !== saved.id), saved],
      }));
      setMessage('Daily attendance record saved. Payroll inputs and operational absence status are synchronized.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function recordAdvance() {
    if (!canManageSensitiveAttendance) return;
    const employee = employees.find((profile) => profile.id === advanceDraft.employeeId);
    if (!employee) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveSalaryAdvance({
        employee,
        date: advanceDraft.date,
        amount: Number(advanceDraft.amount),
        method: advanceDraft.method,
        reference: advanceDraft.reference,
        notes: advanceDraft.notes,
        recordedByUserId: principal.userId,
        recordedByName: principal.displayName,
      });
      setAttendance((current) => ({ ...current, advances: [...(current.advances ?? []), saved] }));
      setAdvanceDraft((current) => ({ ...current, amount: '', reference: '', notes: '' }));
      setPeriodAnchor(advanceDraft.date);
      setMessage('Salary advance recorded as a payroll input. No automatic payroll deduction was applied.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className={styles.notice}>Loading employee attendance and payroll inputs…</div>;

  return (
    <div className={styles.workspace}>
      <div className={styles.commandBar}>
        <div className={styles.periodBlock}>
          <button className={styles.iconButton} type="button" onClick={() => setPeriodAnchor((value) => shiftDateMonth(value, -1))} aria-label="Previous payroll period">‹</button>
          <div className={styles.periodCopy}>
            <div className={styles.eyebrow}>Payroll input period · closes every 26th</div>
            <h2 className={styles.periodTitle}>{periodLabel(period.start, period.end)}</h2>
            <div className={styles.muted}>Attendance is controlled by payroll period, not by calendar month.</div>
          </div>
          <button className={styles.iconButton} type="button" onClick={() => setPeriodAnchor((value) => shiftDateMonth(value, 1))} aria-label="Next payroll period">›</button>
        </div>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} type="button" onClick={() => setPeriodAnchor(today)}>Current period</button>
          <button className={styles.secondaryButton} type="button" onClick={() => void load()}>Refresh</button>
          <button className={styles.secondaryButton} type="button" onClick={exportAccountingCsv} disabled={!canManageSensitiveAttendance}>Export accounting CSV</button>
          <button className={styles.primaryButton} type="button" onClick={() => setTab('advances')} disabled={!canManageSensitiveAttendance}>+ Salary Advance</button>
        </div>
      </div>

      {!canManageSensitiveAttendance ? (
        <div className={styles.notice}>Payroll-sensitive details are protected. Your current role can see workforce context but cannot read or edit employee payroll inputs.</div>
      ) : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      <div className={styles.metricsGrid}>
        <Metric label="Regular hours" value={hours(totals.regular)} sub={`Clock records: ${hoursAndMinutes(totals.workedMinutes)}`} accent="#1267d6" />
        <Metric label="Overtime" value={hours(totals.overtime)} sub="Current rule: after 5:00 PM" accent="#7b4ab8" />
        <Metric label="AO / Sick" value={hours(totals.ao)} sub="Full or partial hours" accent="#a14bb5" />
        <Metric label="No Work No Pay" value={hours(totals.nwnp)} sub="Unpaid full or partial hours" accent="#b12b3c" />
        <Metric label="Vacation" value={hours(totals.vacation)} sub={`Paid-free half-days: ${hours(totals.paidFree)}`} accent="#147f9b" />
        <Metric label="Salary advances" value={money(totals.advances)} sub={`${periodAdvances.length} record${periodAdvances.length === 1 ? '' : 's'} this period`} accent="#b25b00" />
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Attendance sections">
        <button type="button" className={`${styles.tab} ${tab === 'overview' ? styles.activeTab : ''}`} onClick={() => setTab('overview')}>Period Overview</button>
        <button type="button" className={`${styles.tab} ${tab === 'calendar' ? styles.activeTab : ''}`} onClick={() => setTab('calendar')}>Employee Calendar</button>
        <button type="button" className={`${styles.tab} ${tab === 'advances' ? styles.activeTab : ''}`} onClick={() => setTab('advances')}>Salary Advances</button>
      </div>

      {tab === 'overview' ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div className={styles.headerCopy}>
              <h3 className={styles.panelTitle}>Employee attendance summary</h3>
              <div className={styles.muted}>One operational view of regular hours, exceptions, overtime, half-days and advances for the selected payroll period.</div>
            </div>
            <div className={styles.filters}>
              <input className={styles.searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee, role or van…" />
              <span className={styles.badge}>{filteredSummaries.length} employees</span>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.rosterTable}>
              <thead>
                <tr>
                  <th>Employee</th><th>Regular</th><th>OT</th><th>AO</th><th>Vacation</th><th>NWNP</th><th>Paid Free</th><th>Advances</th><th>Late</th><th>Records</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filteredSummaries.map((summary) => {
                  const name = staffDisplayName(summary.employee);
                  return (
                    <tr key={summary.employee.id} className={styles.rosterRow} onClick={() => openEmployee(summary.employee.id)}>
                      <td>
                        <div className={styles.employeeCell}>
                          <span className={styles.avatar}>{initials(name)}</span>
                          <span><span className={styles.employeeName}>{name}</span><span className={styles.employeeMeta}>{summary.employee.role ?? summary.employee.employeeType ?? 'Employee'} · {summary.vanLabel}</span></span>
                        </div>
                      </td>
                      <td className={styles.numberStrong}>{hours(summary.regular)}</td>
                      <td className={summary.overtime ? styles.info : ''}>{hours(summary.overtime)}</td>
                      <td className={summary.ao ? styles.warning : ''}>{hours(summary.ao)}</td>
                      <td>{hours(summary.vacation)}</td>
                      <td className={summary.nwnp ? styles.danger : ''}>{hours(summary.nwnp)}</td>
                      <td>{hours(summary.paidFree)}</td>
                      <td className={summary.advances ? styles.warning : ''}>{money(summary.advances)}</td>
                      <td>{hoursAndMinutes(summary.lateMinutes)}</td>
                      <td>{summary.recordedDays}</td>
                      <td><button className={styles.rowAction} type="button" onClick={(event) => { event.stopPropagation(); openEmployee(summary.employee.id); }}>Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!filteredSummaries.length ? <div className={styles.empty}>No employees match the current filter.</div> : null}
        </section>
      ) : null}

      {tab === 'calendar' ? (
        <div className={styles.calendarLayout}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.employeePicker}>
                <div>
                  <div className={styles.eyebrow}>Employee record</div>
                  <select className={styles.select} value={selectedEmployee?.id ?? ''} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                    {employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)} · {employee.role ?? employee.employeeType ?? 'Employee'}</option>)}
                  </select>
                </div>
              </div>
              <div className={styles.calendarHeader}>
                <button className={styles.iconButton} type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))}>‹</button>
                <strong>{monthLabel(month)}</strong>
                <button className={styles.iconButton} type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))}>›</button>
                <button className={styles.secondaryButton} type="button" onClick={() => { setMonth(monthKey(today)); setSelectedDate(today); }}>Today</button>
              </div>
            </div>
            <div className={styles.weekHeader}>{WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}</div>
            <div className={styles.calendarGrid}>
              {monthCells.map((date, index) => {
                if (!date) return <div key={`blank-${index}`} className={styles.dayBlank} />;
                const record = selectedEmployee ? recordsFor(selectedEmployee, date) : null;
                return (
                  <button key={date} type="button" className={`${styles.dayButton} ${date === selectedDate ? styles.daySelected : ''}`} onClick={() => setSelectedDate(date)}>
                    <span className={styles.dayNumber}>{Number(date.slice(-2))}</span>
                    <span className={styles.dayState} data-tone={statusTone(record?.status ?? null)}>{record?.status ? ATTENDANCE_STATUS_LABELS[record.status] : 'No record'}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.editorCard}>
            <div className={styles.editorBody}>
              <div className={styles.editorHeader}>
                <div>
                  <div className={styles.eyebrow}>Daily record</div>
                  <h3 className={styles.editorTitle}>{formatDate(selectedDate)}</h3>
                  <div className={styles.muted}>{selectedRecord?.schedule.label ?? 'No schedule'} · {selectedEmployee ? staffDisplayName(selectedEmployee) : 'No employee'}</div>
                </div>
                <span className={styles.statusPill}>{draft ? ATTENDANCE_STATUS_LABELS[draft.status] : 'No record'}</span>
              </div>

              {draft && selectedRecord ? (
                <div className={styles.formGrid}>
                  <div className={styles.fieldFull}><div className={styles.notice}>Scheduled {hours(selectedRecord.schedule.scheduledMinutes / 60)} · Paid free {hours(selectedRecord.schedule.paidFreeMinutes / 60)}. Full-day and partial AO/NWNP are supported.</div></div>
                  <div className={styles.field}><label>Status</label><select className={styles.select} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as AttendanceStatus, exceptionHours: ['Sick', 'Vacation', 'Absent'].includes(event.target.value) ? (draft.exceptionHours ?? selectedRecord.schedule.scheduledMinutes / 60) : undefined })}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_LABELS[status]}</option>)}</select></div>
                  <div className={styles.field}><label>Exception hours</label><input className={styles.input} type="number" min="0" max={selectedRecord.schedule.scheduledMinutes / 60} step="0.25" disabled={!['Sick', 'Vacation', 'Absent'].includes(draft.status)} value={draft.exceptionHours ?? ''} onChange={(event) => setDraft({ ...draft, exceptionHours: Number(event.target.value) })} /><span className={styles.fieldHelp}>Use less than the scheduled day for partial AO, vacation or NWNP.</span></div>
                  <div className={styles.field}><label>Clock in</label><input className={styles.input} type="time" value={draft.clockInTime} onChange={(event) => setDraft({ ...draft, clockInTime: event.target.value })} /></div>
                  <div className={styles.field}><label>Clock out</label><input className={styles.input} type="time" value={draft.clockOutTime} onChange={(event) => setDraft({ ...draft, clockOutTime: event.target.value })} /></div>
                  <div className={styles.field}><label>Break minutes</label><input className={styles.input} type="number" min="0" step="5" value={draft.breakMinutes} onChange={(event) => setDraft({ ...draft, breakMinutes: Number(event.target.value) })} /></div>
                  <div className={styles.field}><label>Overtime minutes</label><input className={styles.input} type="number" min="0" step="5" value={draft.overtimeMinutes} onChange={(event) => setDraft({ ...draft, overtimeMinutes: Number(event.target.value) })} /><span className={styles.fieldHelp}>Current rule recognizes overtime after 5:00 PM.</span></div>
                  {suggestedOvertime !== draft.overtimeMinutes ? <div className={styles.exceptionPanel}>Clock-out suggests <strong>{hoursAndMinutes(suggestedOvertime)}</strong> after 5:00 PM. <button className={styles.suggestionButton} type="button" onClick={() => setDraft({ ...draft, overtimeMinutes: suggestedOvertime })}>Use suggestion</button></div> : null}
                  <div className={styles.computedPanel}>
                    <div className={styles.computedItem}><span>Scheduled</span><strong>{hours(selectedRecord.schedule.scheduledMinutes / 60)}</strong></div>
                    <div className={styles.computedItem}><span>Clock worked</span><strong>{hoursAndMinutes(selectedWorkedMinutes)}</strong></div>
                    <div className={styles.computedItem}><span>Regular input</span><strong>{hours(selectedRegularHours)}</strong></div>
                    <div className={styles.computedItem}><span>Paid free</span><strong>{hours(selectedRecord.schedule.paidFreeMinutes / 60)}</strong></div>
                  </div>
                  <div className={`${styles.field} ${styles.fieldFull}`}><label>Notes</label><textarea className={styles.textarea} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Attendance note, AO detail, authorization, reason…" /></div>
                </div>
              ) : <div className={styles.empty}>Select an employee and date to record attendance.</div>}

              <div className={styles.editorFooter}>
                <button className={styles.primaryButton} type="button" disabled={busy || !canManageSensitiveAttendance || !draft} onClick={() => void saveDay()}>{busy ? 'Saving…' : 'Save Daily Record'}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'advances' ? (
        <div className={styles.advancesLayout}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div className={styles.headerCopy}><h3 className={styles.panelTitle}>Salary advance ledger</h3><div className={styles.muted}>Cash and bank-transfer advances tied to the selected payroll period.</div></div>
              <span className={styles.badge}>{periodAdvances.length} records · {money(totals.advances)}</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.advanceTable}>
                <thead><tr><th>Date</th><th>Employee</th><th>Method</th><th>Reference</th><th>Amount</th><th>Recorded by</th></tr></thead>
                <tbody>
                  {periodAdvances.map((advance: EmployeeSalaryAdvance) => (
                    <tr key={advance.id}><td>{shortDate(advance.date)}</td><td>{advance.employeeName}</td><td><span className={styles.methodPill}>{advance.method}</span></td><td>{advance.reference || '—'}</td><td className={styles.numberStrong}>{money(advance.amount)}</td><td>{advance.recordedByName || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!periodAdvances.length ? <div className={styles.empty}>No salary advances recorded for this payroll period.</div> : null}
          </section>

          <section className={styles.advanceCard}>
            <div className={styles.advanceBody}>
              <div className={styles.eyebrow}>New payroll input</div>
              <h3 className={styles.editorTitle}>Record Salary Advance</h3>
              <p className={styles.muted}>This ledger records the advance only. It does not invent or apply an automatic repayment/deduction rule.</p>
              <div className={styles.advanceSummary}>
                <div className={styles.advanceMini}><span>Period total</span><strong>{money(totals.advances)}</strong></div>
                <div className={styles.advanceMini}><span>Entries</span><strong>{periodAdvances.length}</strong></div>
              </div>
              <div className={styles.formGrid}>
                <div className={`${styles.field} ${styles.fieldFull}`}><label>Employee</label><select className={styles.select} value={advanceDraft.employeeId} onChange={(event) => setAdvanceDraft({ ...advanceDraft, employeeId: event.target.value })}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)} · {employee.role ?? employee.employeeType ?? 'Employee'}</option>)}</select></div>
                <div className={styles.field}><label>Date</label><input className={styles.input} type="date" value={advanceDraft.date} onChange={(event) => setAdvanceDraft({ ...advanceDraft, date: event.target.value })} /></div>
                <div className={styles.field}><label>Amount (Afl.)</label><input className={styles.input} type="number" min="0" step="0.01" value={advanceDraft.amount} onChange={(event) => setAdvanceDraft({ ...advanceDraft, amount: event.target.value })} /></div>
                <div className={styles.field}><label>Method</label><select className={styles.select} value={advanceDraft.method} onChange={(event) => setAdvanceDraft({ ...advanceDraft, method: event.target.value as SalaryAdvanceMethod })}><option value="Bank Transfer">Bank Transfer</option><option value="Cash">Cash</option></select></div>
                <div className={styles.field}><label>Reference / receipt</label><input className={styles.input} value={advanceDraft.reference} onChange={(event) => setAdvanceDraft({ ...advanceDraft, reference: event.target.value })} placeholder="Optional reference" /></div>
                <div className={`${styles.field} ${styles.fieldFull}`}><label>Notes</label><textarea className={styles.textarea} value={advanceDraft.notes} onChange={(event) => setAdvanceDraft({ ...advanceDraft, notes: event.target.value })} placeholder="Reason or internal note…" /></div>
              </div>
              <div className={styles.editorFooter}><button className={styles.primaryButton} type="button" disabled={busy || !canManageSensitiveAttendance || !advanceDraft.amount} onClick={() => void recordAdvance()}>{busy ? 'Saving…' : 'Record Advance'}</button></div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className={styles.metricCard} style={{ '--metric-accent': accent } as React.CSSProperties}>
      <span className={styles.metricLabel}>{label}</span>
      <strong className={styles.metricValue}>{value}</strong>
      <span className={styles.metricSub}>{sub}</span>
    </div>
  );
}
