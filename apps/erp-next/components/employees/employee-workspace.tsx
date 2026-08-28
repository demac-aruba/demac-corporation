'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  loadCanonicalOperationsState,
  staffDisplayName,
  type CanonicalOperationsState,
  type CanonicalStaffProfile,
} from '@/lib/canonical-operations';
import {
  ATTENDANCE_STATUS_LABELS,
  dateKey,
  loadEmployeeAttendanceState,
  payrollPeriodBounds,
  saveAttendanceDay,
  saveSalaryAdvance,
  type AttendanceDayDraft,
  type AttendanceExceptionKind,
  type AttendancePaymentTreatment,
  type AttendanceStatus,
  type EmployeeAttendanceState,
  type EmployeeSalaryAdvance,
  type SalaryAdvanceMethod,
} from '@/lib/employee-attendance';
import {
  attendanceExceptionKindLabel,
  calculateAttendanceVariance,
  scheduledBreakMinutes,
} from '@/lib/employee-attendance-calculation';
import { deriveAttendanceDay, summarizeAttendancePeriod } from '@/lib/employee-attendance-policy';
import { payrollPeriodFromDates, shiftPayrollPeriod, summarizeEmployee } from '@/lib/employee-payroll';
import { downloadPayrollAccountingPdf } from '@/lib/payroll-accounting-pdf';
import { employeeVan as resolveEmployeeVan } from '@/lib/employee-work-schedule';
import { EmployeeDirectoryOverview, type EmployeeDirectoryPeriodSummary } from './employee-directory-overview';
import { EmployeeProfileDialog } from './employee-profile-dialog';
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
  overtime: number;
  ao: number;
  vacation: number;
  nwnp: number;
  paidFree: number;
  lateMinutes: number;
  advances: number;
  recordedDays: number;
  exceptionDays: number;
};
type CalendarCell = { date: string; inPeriod: boolean };

export function EmployeeWorkspace() {
  const { principal } = useAuth();
  const canManageSensitiveAttendance = principal.role === 'super_admin' || principal.capabilities.has('payroll_sensitive.view');
  const canManageEmployees = principal.capabilities.has('employees.manage');
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
  const [draft, setDraft] = useState<AttendanceDayDraft | null>(null);
  const [advanceDraft, setAdvanceDraft] = useState({ employeeId: '', date: today, amount: '', method: 'Bank Transfer' as SalaryAdvanceMethod, reference: '', notes: '' });
  const [profileTargetId, setProfileTargetId] = useState<string | null | undefined>(undefined);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const canonical = await loadCanonicalOperationsState();
      setOperations(canonical);
      const active = canonical.staffProfiles.filter((profile) => profile.active !== false);
      const first = active[0] ?? canonical.staffProfiles[0];
      setSelectedEmployeeId((current) => active.some((profile) => profile.id === current) ? current : first?.id ?? '');
      setAdvanceDraft((current) => ({ ...current, employeeId: active.some((profile) => profile.id === current.employeeId) ? current.employeeId : first?.id ?? '' }));
      if (canManageSensitiveAttendance) {
        try { setAttendance(await loadEmployeeAttendanceState()); }
        catch (cause) { setError(`Attendance/payroll records are restricted or unavailable: ${errorText(cause)}`); }
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [canManageSensitiveAttendance]);

  useEffect(() => { void load(true); }, [load]);

  const employees = useMemo(() => (operations?.staffProfiles ?? []).filter((profile) => profile.active !== false), [operations]);
  const selectedEmployee = employees.find((profile) => profile.id === selectedEmployeeId) ?? employees[0] ?? null;
  const period = useMemo(() => payrollPeriodBounds(periodAnchor), [periodAnchor]);
  const calendarCells = useMemo(() => payrollCalendarDays(period.start, period.end), [period.end, period.start]);

  useEffect(() => {
    if (selectedDate < period.start || selectedDate > period.end) setSelectedDate(period.end);
  }, [period.end, period.start, selectedDate]);

  const employeeVan = useCallback((profile: CanonicalStaffProfile | null) => {
    if (!operations || !profile) return null;
    return resolveEmployeeVan(profile, operations.vans);
  }, [operations]);

  const recordsFor = useCallback((profile: CanonicalStaffProfile, date: string) => {
    if (!operations) throw new Error('Employee operations state is not loaded.');
    return deriveAttendanceDay({ employee: profile, date, operations, attendance });
  }, [attendance, operations]);

  const buildDraft = useCallback((profile: CanonicalStaffProfile, date: string) => {
    const record = recordsFor(profile, date);
    const defaultBreak = scheduledBreakMinutes(record.schedule);
    const status = record.status ?? 'Day Off';
    const exceptionHours = status === 'Sick' ? record.entry?.aoHours : status === 'Vacation' ? record.entry?.vacationHours : status === 'Absent' ? record.entry?.noWorkNoPayHours : undefined;
    return {
      status,
      clockInTime: record.entry?.clockInTime ?? record.schedule.startTime,
      clockOutTime: record.entry?.clockOutTime ?? record.schedule.endTime,
      breakMinutes: record.entry?.breakMinutes ?? defaultBreak,
      overtimeMinutes: record.entry?.overtimeMinutes ?? Math.round((record.entry?.overtimeHours ?? 0) * 60),
      exceptionHours: exceptionHours ?? (['Sick', 'Vacation', 'Absent'].includes(status) ? record.schedule.scheduledMinutes / 60 : undefined),
      attendanceExceptionClassifications: record.entry?.attendanceExceptions?.map((segment) => ({
        kind: segment.kind,
        treatment: segment.treatment,
        reason: segment.reason,
      })) ?? [],
      notes: record.entry?.notes ?? record.absence?.notes ?? '',
    } satisfies AttendanceDayDraft;
  }, [recordsFor]);

  useEffect(() => { if (selectedEmployee) setDraft(buildDraft(selectedEmployee, selectedDate)); }, [buildDraft, selectedDate, selectedEmployee]);

  const periodSummaries = useMemo<EmployeePeriodSummary[]>(() => {
    if (!operations) return [];
    return employees.map((employee) => {
      const summary = summarizeAttendancePeriod({ employee, period, operations, attendance });
      const advances = (attendance.advances ?? []).filter((advance) => advance.employeeId === employee.id && advance.payrollPeriodId === period.id);
      const van = employeeVan(employee);
      return {
        employee,
        vanLabel: van?.name ?? van?.id ?? employee.primaryVanId ?? 'UNASSIGNED',
        ...summary,
        advances: advances.reduce((sum, advance) => sum + (advance.amount ?? 0), 0),
      };
    });
  }, [attendance, employeeVan, employees, operations, period]);

  const directorySummaries = useMemo<EmployeeDirectoryPeriodSummary[]>(() => periodSummaries.map((summary) => ({
    employeeId: summary.employee.id,
    overtime: summary.overtime,
    ao: summary.ao,
    vacation: summary.vacation,
    nwnp: summary.nwnp,
    lateMinutes: summary.lateMinutes,
    advances: summary.advances,
    exceptionDays: summary.exceptionDays,
  })), [periodSummaries]);

  const totals = useMemo(() => periodSummaries.reduce((acc, row) => ({
    overtime: acc.overtime + row.overtime,
    ao: acc.ao + row.ao,
    vacation: acc.vacation + row.vacation,
    nwnp: acc.nwnp + row.nwnp,
    advances: acc.advances + row.advances,
  }), { overtime: 0, ao: 0, vacation: 0, nwnp: 0, advances: 0 }), [periodSummaries]);

  const periodAdvances = useMemo(() => (attendance.advances ?? []).filter((advance) => advance.payrollPeriodId === period.id).sort((a, b) => b.date.localeCompare(a.date)), [attendance.advances, period.id]);
  const selectedSummary = periodSummaries.find((summary) => summary.employee.id === selectedEmployee?.id);
  const selectedRecord = selectedEmployee ? recordsFor(selectedEmployee, selectedDate) : null;
  const selectedVariance = selectedRecord && draft ? calculateAttendanceVariance({ schedule: selectedRecord.schedule, clockInTime: draft.clockInTime, clockOutTime: draft.clockOutTime, breakMinutes: draft.breakMinutes }) : null;
  const workedStatus = draft?.status === 'Present' || draft?.status === 'Late';
  const detectedAttendanceExceptions = workedStatus ? selectedVariance?.missingSegments ?? [] : [];
  const selectedWorkedMinutes = selectedRecord?.assumedRegular && !selectedRecord.entry && draft?.status === 'Present' && !detectedAttendanceExceptions.length && !(selectedVariance?.overtimeMinutes ?? 0)
    ? selectedRecord.schedule.scheduledMinutes
    : selectedVariance?.workedMinutes ?? 0;
  const selectedExceptionHours = Math.max(0, Number(draft?.exceptionHours) || 0);
  const selectedRegularHours = selectedRecord && draft
    ? workedStatus
      ? Math.max(0, (selectedRecord.schedule.scheduledMinutes - (selectedVariance?.missingScheduledMinutes ?? 0)) / 60)
      : Math.max(0, selectedRecord.schedule.scheduledMinutes / 60 - (['Sick', 'Vacation', 'Absent'].includes(draft.status) ? selectedExceptionHours : 0))
    : 0;
  const partialTreatmentTotals = detectedAttendanceExceptions.reduce((total, segment) => {
    const classification = draft?.attendanceExceptionClassifications?.find((item) => item.kind === segment.kind);
    if (classification?.treatment === 'paid') total.paid += segment.minutes;
    if (classification?.treatment === 'no_work_no_pay') total.unpaid += segment.minutes;
    return total;
  }, { paid: 0, unpaid: 0 });
  const incompleteAttendanceException = detectedAttendanceExceptions.some((segment) => {
    const classification = draft?.attendanceExceptionClassifications?.find((item) => item.kind === segment.kind);
    return !classification?.treatment || !classification.reason?.trim();
  });
  const normalScheduleNeedsNoRecord = Boolean(selectedRecord?.assumedRegular
    && draft?.status === 'Present'
    && (selectedVariance?.overtimeMinutes ?? 0) === 0
    && detectedAttendanceExceptions.length === 0
    && !draft?.notes.trim());
  const selectedAbsenceRanges = useMemo(() => (operations?.staffAbsences ?? []).filter((item) => item.staffId === selectedEmployee?.id && item.active !== false).sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? ''))).slice(0, 4), [operations?.staffAbsences, selectedEmployee?.id]);
  const activeSectionLabel = tab === 'calendar' ? 'Employee Calendar' : tab === 'advances' ? 'Salary Advances' : 'Overview';

  async function refreshAfterEmployeeChange(employeeId?: string) {
    if (employeeId) setSelectedEmployeeId(employeeId);
    await load(false);
  }

  function movePayrollPeriod(offset: number) {
    const shifted = shiftPayrollPeriod(payrollPeriodFromDates(period.start, period.end), offset);
    setPeriodAnchor(shifted.endDate);
    setSelectedDate(shifted.endDate);
  }

  function goToToday() {
    setPeriodAnchor(today);
    setSelectedDate(today);
  }

  function updateAttendanceClassification(kind: AttendanceExceptionKind, changes: { treatment?: AttendancePaymentTreatment; reason?: string }) {
    if (!draft) return;
    const current = draft.attendanceExceptionClassifications ?? [];
    const existing = current.find((item) => item.kind === kind);
    const next = existing
      ? current.map((item) => item.kind === kind ? { ...item, ...changes } : item)
      : [...current, { kind, ...changes }];
    setDraft({ ...draft, attendanceExceptionClassifications: next });
  }

  function exportAccountingCsv() {
    const headers = ['Employee', 'Role', 'Van / Team', 'Scheduled Hours', 'Regular Hours', 'Overtime Hours', 'AO Hours', 'Vacation Hours', 'NWNP Hours', 'Paid Free Hours', 'Salary Advances Afl', 'Late Minutes', 'Exception Days', 'Manual Records'];
    const rows = periodSummaries.map((summary) => [staffDisplayName(summary.employee), summary.employee.role ?? '', summary.vanLabel, summary.scheduled.toFixed(2), summary.regular.toFixed(2), summary.overtime.toFixed(2), summary.ao.toFixed(2), summary.vacation.toFixed(2), summary.nwnp.toFixed(2), summary.paidFree.toFixed(2), summary.advances.toFixed(2), String(summary.lateMinutes), String(summary.exceptionDays), String(summary.recordedDays)]);
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

  function exportPayrollPdf() {
    setError('');
    setMessage('');
    if (!operations) return;
    try {
      const payrollPeriod = payrollPeriodFromDates(period.start, period.end);
      const summaries = employees.map((employee) => summarizeEmployee({ employee, period: payrollPeriod, operations, attendance }));
      const advancesByEmployee = Object.fromEntries(periodSummaries.map((summary) => [summary.employee.id, summary.advances]));
      const downloaded = downloadPayrollAccountingPdf({
        filename: `DEMAC_Payroll_Contabilidad_${period.start}_${period.end}.pdf`,
        periodLabel: payrollPeriod.label,
        summaries,
        advancesByEmployee,
      });
      setMessage(downloaded
        ? `Premium payroll accounting PDF downloaded. ${summaries.length <= 12 ? 'The current workforce fits on one A4 landscape page.' : 'The report continues automatically after 12 employees.'}`
        : 'PDF export is available from the browser version.');
    } catch (cause) {
      setError(`Payroll PDF could not be generated: ${errorText(cause)}`);
    }
  }

  async function saveDay() {
    if (!selectedEmployee || !draft || !selectedRecord || !canManageSensitiveAttendance) return;
    if (incompleteAttendanceException) {
      setError('Classify every missing-time segment as Paid or No Work No Pay and enter a reason before saving.');
      setMessage('');
      return;
    }
    if (normalScheduleNeedsNoRecord) {
      setError('');
      setMessage('Normal scheduled attendance is already counted automatically. No daily record was created.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveAttendanceDay({ employee: selectedEmployee, date: selectedDate, schedule: selectedRecord.schedule, draft, existingEntry: selectedRecord.entry, existingAbsence: selectedRecord.absence, updatedByUserId: principal.userId, updatedByName: principal.displayName });
      setAttendance((current) => ({ ...current, timesheets: [...current.timesheets.filter((entry) => entry.id !== saved.id), saved] }));
      setMessage('Attendance exception saved. Overtime and partial exceptions were calculated from the scheduled shift.');
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

  if (loading) return <div className={styles.loadingCard}>Loading Employees…</div>;
  if (!operations) return <div className={styles.error}>Employee registry is unavailable. {error}</div>;

  const profileEmployee = profileTargetId === undefined || profileTargetId === null ? null : operations.staffProfiles.find((profile) => profile.id === profileTargetId) ?? null;

  return (
    <div className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div className={styles.headerText}>
          <div className={styles.breadcrumb}><span>Workforce</span><b>›</b><span>Employees</span><b>›</b><span>{activeSectionLabel}</span></div>
          <h1>Employees</h1>
          <p>One canonical workspace for employee profiles, attendance exceptions and salary advances. Normal scheduled attendance is automatic.</p>
        </div>
        <div className={styles.headerActions}>
          <details className={styles.quickActions}><summary><Icon name="bolt" />Quick actions <span>⌄</span></summary><div className={styles.quickMenu}><button type="button" onClick={() => void load(false)}>Refresh data</button><button type="button" onClick={() => setProfileTargetId(null)} disabled={!canManageEmployees}>Add employee</button><button type="button" onClick={exportPayrollPdf} disabled={!canManageSensitiveAttendance}>Export payroll summary PDF</button><button type="button" onClick={exportAccountingCsv} disabled={!canManageSensitiveAttendance}>Export accounting CSV</button><button type="button" onClick={() => setTab('advances')} disabled={!canManageSensitiveAttendance}>Record salary advance</button></div></details>
          <div className={styles.periodSelector}><Icon name="calendar" /><div><span>Payroll Period</span><strong>{periodLabel(period.start, period.end)}</strong></div><button type="button" onClick={() => movePayrollPeriod(-1)}>‹</button><button type="button" onClick={() => movePayrollPeriod(1)}>›</button></div>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Employee workspace sections">
        <button type="button" className={tab === 'overview' ? styles.activeTab : ''} onClick={() => setTab('overview')}>Overview</button>
        <button type="button" className={tab === 'calendar' ? styles.activeTab : ''} onClick={() => setTab('calendar')}>Employee Calendar</button>
        <button type="button" className={tab === 'advances' ? styles.activeTab : ''} onClick={() => setTab('advances')}>Salary Advances</button>
      </nav>

      {!canManageSensitiveAttendance ? <div className={styles.notice}>Payroll-sensitive columns are protected. Employee profiles remain available according to your workforce permissions.</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}

      {tab === 'overview' ? <>
        {canManageSensitiveAttendance ? <section className={styles.metricsGrid}>
          <Metric icon="timer" tone="purple" label="Overtime" value={hours(totals.overtime)} sub="Recorded overtime this payroll period" />
          <Metric icon="heart" tone="pink" label="AO / Sick" value={hours(totals.ao)} sub="Full + partial exception hours" />
          <Metric icon="ban" tone="orange" label="No Work No Pay" value={hours(totals.nwnp)} sub="Unpaid exception hours" />
          <Metric icon="vacation" tone="green" label="Vacation" value={hours(totals.vacation)} sub="Recorded vacation exception hours" />
          <Metric icon="wallet" tone="blue" label="Salary Advances" value={money(totals.advances)} sub={`${periodAdvances.length} record${periodAdvances.length === 1 ? '' : 's'} this period`} />
        </section> : null}
        <EmployeeDirectoryOverview
          operations={operations}
          periodSummaries={directorySummaries}
          showPayrollMetrics={canManageSensitiveAttendance}
          canManageEmployees={canManageEmployees}
          today={today}
          onAddEmployee={() => setProfileTargetId(null)}
          onOpenEmployee={(employee) => setProfileTargetId(employee.id)}
        />
      </> : null}

      {tab === 'calendar' ? <>
        <section className={styles.employeeStrip}>
          <div className={styles.employeeIdentity}>
            <div className={styles.avatarLarge}>{selectedEmployee ? initials(staffDisplayName(selectedEmployee)) : '—'}</div>
            <div className={styles.employeeIdentityCopy}>
              <div className={styles.employeeNameLine}><strong>{selectedEmployee ? staffDisplayName(selectedEmployee) : 'No employee selected'}</strong><span className={styles.activeStatus}><i />Active</span></div>
              <div className={styles.employeeSubline}>{selectedEmployee?.role ?? selectedEmployee?.employeeType ?? 'Employee'} · {selectedSummary?.vanLabel ?? 'UNASSIGNED'}</div>
              <select className={styles.changeEmployee} value={selectedEmployee?.id ?? ''} onChange={(event) => setSelectedEmployeeId(event.target.value)}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)} · {employee.role ?? employee.employeeType ?? 'Employee'}</option>)}</select>
            </div>
          </div>
          <MiniStat label="Scheduled" value={hours(selectedSummary?.scheduled ?? 0)} />
          <MiniStat label="Regular" value={hours(selectedSummary?.regular ?? 0)} />
          <MiniStat label="Overtime" value={hours(selectedSummary?.overtime ?? 0)} />
          <MiniStat label="Exceptions" value={String(selectedSummary?.exceptionDays ?? 0)} />
          <MiniStat label="Manual Records" value={String(selectedSummary?.recordedDays ?? 0)} />
          <button type="button" className={styles.profileButton} onClick={() => selectedEmployee && setProfileTargetId(selectedEmployee.id)}><Icon name="user" />View Profile</button>
        </section>

        <div className={styles.mainGrid}>
          <section className={styles.calendarCard}>
            <div className={styles.calendarToolbar}><h2>{monthLabel(monthKey(period.end))}</h2><div className={styles.calendarActions}><button className={styles.squareButton} type="button" onClick={() => movePayrollPeriod(-1)}>‹</button><button className={styles.ghostButton} type="button" onClick={goToToday}>Today</button><span className={styles.viewBadge}>Payroll⌄</span><button className={styles.squareButton} type="button" onClick={() => movePayrollPeriod(1)}>›</button></div></div>
            <div className={styles.weekHeader}>{WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}</div>
            <div className={styles.calendarGrid}>{calendarCells.map(({ date, inPeriod }) => {
              const record = inPeriod && selectedEmployee ? recordsFor(selectedEmployee, date) : null;
              const assumedLabel = date > today ? 'Scheduled' : 'Regular';
              const exceptionCount = record?.entry?.attendanceExceptions?.length ?? 0;
              const hasOvertime = (record?.entry?.overtimeMinutes ?? 0) > 0 || (record?.entry?.overtimeHours ?? 0) > 0;
              const stateLabel = record?.assumedRegular
                ? assumedLabel
                : exceptionCount
                  ? `${record?.status === 'Present' ? 'Present' : statusShort(record?.status ?? null)} · ${exceptionCount} ex.`
                  : hasOvertime && record?.status === 'Present'
                    ? 'Present · OT'
                    : record?.status ? statusShort(record.status) : 'Off';
              return <button
                key={date}
                type="button"
                disabled={!inPeriod}
                title={inPeriod ? formatDate(date) : 'Outside selected payroll period'}
                className={`${styles.dayButton} ${!inPeriod ? styles.dayOutside : ''} ${date === selectedDate ? styles.daySelected : ''}`}
                onClick={() => setSelectedDate(date)}
              ><span className={styles.dayNumber}>{Number(date.slice(-2))}</span>{record?.status ? <span className={styles.dayState} data-tone={statusTone(record.status)}><i />{stateLabel}</span> : <span className={styles.dayNoRecord}>{stateLabel}</span>}</button>;
            })}</div>
            <div className={styles.calendarLegend}><Legend tone="present">Regular / assumed</Legend><Legend tone="late">Late</Legend><Legend tone="sick">AO / Sick</Legend><Legend tone="vacation">Vacation</Legend><Legend tone="none">Off / outside payroll</Legend><span className={styles.historyLink}><Icon name="calendar" />Absence History</span></div>
          </section>

          <aside className={styles.rightRail}>
            <section className={styles.dailyCard}>
              <div className={styles.dailyHeader}><div><h2>Daily Record</h2><span>Selected Date</span><strong><Icon name="calendar" />{formatDate(selectedDate)}</strong><small>{selectedRecord?.schedule.label ?? 'No configured schedule'}</small></div><span className={styles.statusChip} data-tone={draft?.status ?? 'Present'}>{selectedRecord?.assumedRegular && !selectedRecord.entry ? 'Regular' : draft ? statusShort(draft.status) : 'No shift'}⌄</span></div>
              {draft && selectedRecord ? <div className={styles.dailyForm}>
                {selectedRecord.assumedRegular ? <div className={styles.notice}>Normal scheduled attendance is already counted automatically. Enter only what actually changed; overtime and partial missing time are calculated from the employee schedule.</div> : null}
                <Field label="Status" full><select className={styles.control} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as AttendanceStatus, exceptionHours: ['Sick', 'Vacation', 'Absent'].includes(event.target.value) ? (draft.exceptionHours ?? selectedRecord.schedule.scheduledMinutes / 60) : undefined })}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_LABELS[status]}</option>)}</select></Field>
                {['Sick', 'Vacation', 'Absent'].includes(draft.status) ? <Field label="Exception Hours" full><input className={styles.control} type="number" min="0" max={selectedRecord.schedule.scheduledMinutes / 60} step="0.25" value={draft.exceptionHours ?? ''} onChange={(event) => setDraft({ ...draft, exceptionHours: Number(event.target.value) })} /></Field> : null}
                <Field label="Clock In"><input className={styles.control} type="time" value={draft.clockInTime} onChange={(event) => setDraft({ ...draft, clockInTime: event.target.value })} /></Field>
                <Field label="Clock Out"><input className={styles.control} type="time" value={draft.clockOutTime} onChange={(event) => setDraft({ ...draft, clockOutTime: event.target.value })} /></Field>
                <Field label="Break Minutes" full><input className={styles.control} type="number" min="0" step="5" value={draft.breakMinutes} onChange={(event) => setDraft({ ...draft, breakMinutes: Number(event.target.value) })} /></Field>

                {workedStatus && selectedVariance ? <div className={styles.dailySummary}>
                  <SummaryRow icon="timer" label="Calculated Overtime" value={hoursAndMinutes(selectedVariance.overtimeMinutes)} tone="orange" />
                  {selectedVariance.earlyStartMinutes > 0 ? <SummaryRow icon="clock" label="Early start" value={hoursAndMinutes(selectedVariance.earlyStartMinutes)} tone="blue" /> : null}
                  {selectedVariance.lateFinishMinutes > 0 ? <SummaryRow icon="clock" label="Late finish" value={hoursAndMinutes(selectedVariance.lateFinishMinutes)} tone="blue" /> : null}
                  {selectedVariance.unusedBreakMinutes > 0 ? <SummaryRow icon="timer" label="Unused scheduled break" value={hoursAndMinutes(selectedVariance.unusedBreakMinutes)} tone="green" /> : null}
                </div> : null}

                {detectedAttendanceExceptions.map((segment) => {
                  const classification = draft.attendanceExceptionClassifications?.find((item) => item.kind === segment.kind);
                  return <div key={segment.kind} className={styles.dailySummary}>
                    <strong>{attendanceExceptionTitle(segment.kind, segment.fromTime, segment.toTime, segment.minutes)}</strong>
                    <Field label="Payment Treatment" full><select className={styles.control} value={classification?.treatment ?? ''} onChange={(event) => updateAttendanceClassification(segment.kind, { treatment: event.target.value ? event.target.value as AttendancePaymentTreatment : undefined })}><option value="">Select treatment…</option><option value="paid">Paid</option><option value="no_work_no_pay">No Work No Pay</option></select></Field>
                    <Field label="Reason" full><input className={styles.control} value={classification?.reason ?? ''} onChange={(event) => updateAttendanceClassification(segment.kind, { reason: event.target.value })} placeholder="Doctor appointment, personal permission, sick, other…" /></Field>
                  </div>;
                })}

                {incompleteAttendanceException ? <div className={styles.notice}>Classify every missing-time segment as Paid or No Work No Pay and enter a reason before saving.</div> : null}

                <Field label="Notes" full><textarea className={`${styles.control} ${styles.notes}`} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Add notes for this exception…" /></Field>
                <div className={styles.dailySummary}>
                  <SummaryRow icon="clock" label="Scheduled" value={hours(selectedRecord.schedule.scheduledMinutes / 60)} tone="blue" />
                  <SummaryRow icon="vacation" label="Scheduled Paid Free" value={hours(selectedRecord.schedule.paidFreeMinutes / 60)} tone="green" />
                  <SummaryRow icon="briefcase" label="Actual Worked" value={hoursAndMinutes(selectedWorkedMinutes)} tone="blue" />
                  <SummaryRow icon="briefcase" label="Regular After Exceptions" value={hours(selectedRegularHours)} tone="blue" />
                  {workedStatus ? <SummaryRow icon="timer" label="Overtime" value={hoursAndMinutes(selectedVariance?.overtimeMinutes ?? 0)} tone="orange" /> : null}
                  {partialTreatmentTotals.paid > 0 ? <SummaryRow icon="heart" label="Paid Missing Time" value={hoursAndMinutes(partialTreatmentTotals.paid)} tone="green" /> : null}
                  {partialTreatmentTotals.unpaid > 0 ? <SummaryRow icon="ban" label="No Work No Pay" value={hoursAndMinutes(partialTreatmentTotals.unpaid)} tone="pink" /> : null}
                </div>
                <button className={styles.saveButton} type="button" disabled={busy || !canManageSensitiveAttendance || normalScheduleNeedsNoRecord || incompleteAttendanceException} onClick={() => void saveDay()}>{busy ? 'Saving…' : normalScheduleNeedsNoRecord ? 'No Exception to Save' : incompleteAttendanceException ? 'Classify Missing Time to Save' : 'Save Exception'}</button>
              </div> : <div className={styles.empty}>No scheduled shift for this employee and date.</div>}
            </section>
            <section className={styles.rangesCard}><div className={styles.rangesIcon}><Icon name="calendar" /></div><div><h3>Recent / Scheduled Ranges</h3>{selectedAbsenceRanges.length ? selectedAbsenceRanges.map((range) => <p key={range.id}><strong>{range.reason ?? 'Absence'}</strong> · {range.fromDate ?? '—'}{range.toDate && range.toDate !== range.fromDate ? ` → ${range.toDate}` : ''}</p>) : <p>No absence ranges recorded.</p>}</div></section>
          </aside>
        </div>
      </> : null}

      {tab === 'advances' ? <div className={styles.advancesLayout}>
        <section className={styles.advanceLedger}><div className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>Payroll input ledger</span><h2>Salary Advances</h2><p>Cash and bank-transfer advances tied to the selected payroll period.</p></div><span className={styles.totalPill}>{periodAdvances.length} records · {money(totals.advances)}</span></div><div className={styles.tableWrap}><table className={styles.advanceTable}><thead><tr><th>Date</th><th>Employee</th><th>Method</th><th>Reference</th><th>Amount</th><th>Recorded by</th></tr></thead><tbody>{periodAdvances.map((advance: EmployeeSalaryAdvance) => <tr key={advance.id}><td>{shortDate(advance.date)}</td><td>{advance.employeeName}</td><td><span className={styles.methodPill}>{advance.method}</span></td><td>{advance.reference || '—'}</td><td><strong>{money(advance.amount)}</strong></td><td>{advance.recordedByName || '—'}</td></tr>)}</tbody></table></div>{!periodAdvances.length ? <div className={styles.empty}>No salary advances recorded for this payroll period.</div> : null}</section>
        <section className={styles.advanceFormCard}><span className={styles.sectionEyebrow}>New payroll input</span><h2>Record Salary Advance</h2><p>This records the advance only; it does not apply an automatic deduction.</p><div className={styles.dailyForm}><Field label="Employee" full><select className={styles.control} value={advanceDraft.employeeId} onChange={(event) => setAdvanceDraft({ ...advanceDraft, employeeId: event.target.value })}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)} · {employee.role ?? employee.employeeType ?? 'Employee'}</option>)}</select></Field><Field label="Date"><input className={styles.control} type="date" value={advanceDraft.date} onChange={(event) => setAdvanceDraft({ ...advanceDraft, date: event.target.value })} /></Field><Field label="Amount (Afl.)"><input className={styles.control} type="number" min="0" step="0.01" value={advanceDraft.amount} onChange={(event) => setAdvanceDraft({ ...advanceDraft, amount: event.target.value })} /></Field><Field label="Method"><select className={styles.control} value={advanceDraft.method} onChange={(event) => setAdvanceDraft({ ...advanceDraft, method: event.target.value as SalaryAdvanceMethod })}><option value="Bank Transfer">Bank Transfer</option><option value="Cash">Cash</option></select></Field><Field label="Reference / Receipt"><input className={styles.control} value={advanceDraft.reference} onChange={(event) => setAdvanceDraft({ ...advanceDraft, reference: event.target.value })} placeholder="Optional reference" /></Field><Field label="Notes" full><textarea className={`${styles.control} ${styles.notes}`} value={advanceDraft.notes} onChange={(event) => setAdvanceDraft({ ...advanceDraft, notes: event.target.value })} placeholder="Reason or internal note…" /></Field><button className={styles.saveButton} type="button" disabled={busy || !canManageSensitiveAttendance || !advanceDraft.amount} onClick={() => void recordAdvance()}>{busy ? 'Saving…' : 'Record Advance'}</button></div></section>
      </div> : null}

      <EmployeeProfileDialog
        open={profileTargetId !== undefined}
        employee={profileEmployee}
        operations={operations}
        onClose={() => setProfileTargetId(undefined)}
        onChanged={refreshAfterEmployeeChange}
      />
    </div>
  );
}

function Metric({ icon, tone, label, value, sub }: { icon: IconName; tone: string; label: string; value: string; sub: string }) {
  return <article className={styles.metricCard}><div className={styles.metricIcon} data-tone={tone}><Icon name={icon} /></div><div><span className={styles.metricLabel}>{label}</span><strong className={styles.metricValue}>{value}</strong><span className={styles.metricSub}>{sub}</span></div></article>;
}
function MiniStat({ label, value }: { label: string; value: string }) { return <div className={styles.miniStat}><span>{label}</span><strong>{value}</strong><small>This period</small></div>; }
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) { return <label className={`${styles.field} ${full ? styles.fieldFull : ''}`}><span>{label}</span>{children}</label>; }
function Legend({ tone, children }: { tone: string; children: ReactNode }) { return <span className={styles.legendItem} data-tone={tone}><i />{children}</span>; }
function SummaryRow({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone: string }) { return <div className={styles.summaryRow}><span className={styles.summaryIcon} data-tone={tone}><Icon name={icon} /></span><span>{label}</span><strong>{value}</strong></div>; }

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

function monthKey(date: string) { return date.slice(0, 7); }
function monthLabel(value: string) { return new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-AW', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function formatDate(value: string) { return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function shortDate(value: string) { return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function periodLabel(start: string, end: string) { return `${shortDate(start)} – ${shortDate(end)}`; }
function payrollCalendarDays(start: string, end: string): CalendarCell[] {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  const calendarStart = new Date(first);
  calendarStart.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const calendarEnd = new Date(last);
  calendarEnd.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const count = Math.round((calendarEnd.getTime() - calendarStart.getTime()) / 86_400_000) + 1;
  return Array.from({ length: count }, (_, index) => {
    const current = new Date(calendarStart);
    current.setUTCDate(calendarStart.getUTCDate() + index);
    const date = current.toISOString().slice(0, 10);
    return { date, inPeriod: date >= start && date <= end };
  });
}
function attendanceExceptionTitle(kind: AttendanceExceptionKind, fromTime: string | undefined, toTime: string | undefined, minutes: number) {
  const range = fromTime && toTime ? ` · ${fromTime}–${toTime}` : '';
  const label = attendanceExceptionKindLabel(kind).replace(/^./, (character) => character.toUpperCase());
  return `${label}${range} · ${hoursAndMinutes(minutes)}`;
}
function hoursAndMinutes(minutes: number | undefined) { const value = Math.max(0, Math.round(Number(minutes) || 0)); const h = Math.floor(value / 60); const m = value % 60; if (!h) return `${m}m`; if (!m) return `${h}h 00m`; return `${h}h ${String(m).padStart(2, '0')}m`; }
function hours(value: number) { return hoursAndMinutes(Math.round((Number(value) || 0) * 60)); }
function money(value: number) { return `Afl. ${(Number(value) || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function escapeCsv(value: unknown) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function initials(name: string) { const parts = name.trim().split(/\s+/).filter(Boolean); return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase() || '—'; }
function statusTone(status: AttendanceStatus | null) { return status ?? 'No record'; }
function statusShort(status: AttendanceStatus | null) { if (!status) return 'No shift'; if (status === 'Sick') return 'AO / Sick'; if (status === 'Absent') return 'NWNP'; return ATTENDANCE_STATUS_LABELS[status]; }
