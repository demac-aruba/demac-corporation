'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  canonicalVanId,
  loadCanonicalOperationsState,
  staffDisplayName,
  type CanonicalOperationsState,
  type CanonicalStaffAbsence,
  type CanonicalStaffProfile,
} from '@/lib/canonical-operations';
import { saveCanonicalStaffAbsence } from '@/lib/canonical-operations-mutations';
import {
  ATTENDANCE_STATUS_LABELS,
  absenceForDate,
  dateKey,
  loadEmployeeAttendanceState,
  payrollSettingsForStaff,
  saveAttendanceDay,
  statusFromRecords,
  timesheetForDate,
  type AttendanceDayDraft,
  type AttendanceStatus,
  type EmployeeAttendanceState,
} from '@/lib/employee-attendance';
import { employeeVan, resolveEmployeeSchedule } from '@/lib/employee-work-schedule';

const STATUS_OPTIONS = Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ABSENCE_TYPES = [
  { value: 'Enfermo', label: 'Sick / AO' },
  { value: 'Vacaciones', label: 'Vacation' },
  { value: 'Libre', label: 'Day Off' },
  { value: 'Otro', label: 'Absent / Other' },
] as const;

type AbsenceDraft = {
  staffId: string;
  fromDate: string;
  toDate: string;
  reason: string;
  notes: string;
};

function monthKey(date: string) {
  return date.slice(0, 7);
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(value: string) {
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-AW', { month: 'long', year: 'numeric', timeZone: 'UTC' });
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

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function hoursAndMinutes(minutes: number | undefined) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function statusLabel(status: AttendanceStatus | null) {
  return status ? ATTENDANCE_STATUS_LABELS[status] : 'No record';
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function EmployeeAttendanceWorkspace() {
  const { principal } = useAuth();
  const canManageSensitiveAttendance = principal.role === 'super_admin' || principal.capabilities.has('payroll_sensitive.view');
  const canManageAbsences = ['super_admin', 'operations', 'office_operator'].includes(principal.role);
  const [operations, setOperations] = useState<CanonicalOperationsState | null>(null);
  const [attendance, setAttendance] = useState<EmployeeAttendanceState>({ payrollSettings: [], timesheets: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [month, setMonth] = useState(() => monthKey(dateKey(new Date())));
  const [draft, setDraft] = useState<AttendanceDayDraft | null>(null);
  const [absenceDraft, setAbsenceDraft] = useState<AbsenceDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const canonical = await loadCanonicalOperationsState();
      setOperations(canonical);
      if (canManageSensitiveAttendance) {
        try {
          setAttendance(await loadEmployeeAttendanceState());
        } catch (cause) {
          setError(`Attendance/payroll records are restricted or unavailable: ${errorText(cause)}`);
        }
      }
      if (!selectedEmployeeId) setSelectedEmployeeId(canonical.staffProfiles.find((profile) => profile.active !== false)?.id ?? '');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [canManageSensitiveAttendance, selectedEmployeeId]);

  useEffect(() => { void load(); }, [load]);

  const employees = useMemo(() => (operations?.staffProfiles ?? []).filter((profile) => profile.active !== false), [operations]);
  const selectedEmployee = employees.find((profile) => profile.id === selectedEmployeeId) ?? employees[0] ?? null;
  const monthCells = useMemo(() => calendarDays(month), [month]);
  const relevantAbsences = useMemo(() => (operations?.staffAbsences ?? [])
    .filter((absence) => absence.staffId === selectedEmployee?.id)
    .sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? ''))), [operations?.staffAbsences, selectedEmployee?.id]);

  function scheduleForDate(profile: CanonicalStaffProfile, date: string) {
    if (!operations) throw new Error('Operations data is not loaded.');
    return resolveEmployeeSchedule({
      profile,
      date,
      payrollSettings: payrollSettingsForStaff(attendance.payrollSettings, profile.id),
      vans: operations.vans,
      halfDaySchedules: operations.vanHalfDaySchedules,
    });
  }

  function recordsFor(profile: CanonicalStaffProfile, date: string) {
    const schedule = scheduleForDate(profile, date);
    const absence = absenceForDate(operations?.staffAbsences ?? [], profile.id, date);
    const entry = timesheetForDate(attendance.timesheets, profile.id, date);
    const status = statusFromRecords(entry, absence, schedule.scheduledMinutes);
    return { schedule, absence, entry, status };
  }

  function setDayDraft(profile: CanonicalStaffProfile, date: string) {
    const record = recordsFor(profile, date);
    const defaultBreak = record.schedule.scheduledMinutes >= 480 ? 60 : 0;
    setDraft({
      status: record.status ?? (record.schedule.scheduledMinutes ? 'Present' : 'Day Off'),
      clockInTime: record.entry?.clockInTime ?? record.schedule.startTime,
      clockOutTime: record.entry?.clockOutTime ?? record.schedule.endTime,
      breakMinutes: record.entry?.breakMinutes ?? defaultBreak,
      overtimeMinutes: record.entry?.overtimeMinutes ?? Math.round((record.entry?.overtimeHours ?? 0) * 60),
      notes: record.entry?.notes ?? record.absence?.notes ?? '',
    });
  }

  function selectDate(value: string) {
    setSelectedDate(value);
    setMonth(monthKey(value));
    if (selectedEmployee) setDayDraft(selectedEmployee, value);
    setMessage('');
  }

  useEffect(() => {
    if (selectedEmployee && operations) setDayDraft(selectedEmployee, selectedDate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId, operations?.staffAbsences]);

  const monthMetrics = useMemo(() => {
    if (!selectedEmployee || !operations) return { present: 0, late: 0, sick: 0, vacation: 0, absent: 0 };
    const metrics = { present: 0, late: 0, sick: 0, vacation: 0, absent: 0 };
    monthCells.filter((value): value is string => Boolean(value)).forEach((date) => {
      const status = recordsFor(selectedEmployee, date).status;
      if (status === 'Present') metrics.present += 1;
      if (status === 'Late') metrics.late += 1;
      if (status === 'Sick') metrics.sick += 1;
      if (status === 'Vacation') metrics.vacation += 1;
      if (status === 'Absent') metrics.absent += 1;
    });
    return metrics;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance.timesheets, monthCells, operations?.staffAbsences, selectedEmployeeId]);

  async function saveDay() {
    if (!selectedEmployee || !draft || !operations) return;
    if (!canManageSensitiveAttendance) return setError('Only the owner / administrator or authorized finance user can edit attendance-linked payroll records.');
    const record = recordsFor(selectedEmployee, selectedDate);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveAttendanceDay({
        employee: selectedEmployee,
        date: selectedDate,
        schedule: record.schedule,
        draft,
        existingEntry: record.entry,
        existingAbsence: record.absence,
        updatedByUserId: principal.userId,
        updatedByName: principal.displayName,
      });
      setAttendance((current) => ({ ...current, timesheets: [saved, ...current.timesheets.filter((entry) => entry.id !== saved.id)] }));
      setOperations(await loadCanonicalOperationsState());
      setMessage(`${staffDisplayName(selectedEmployee)} · ${formatDate(selectedDate)} saved.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function openAbsenceRange() {
    if (!selectedEmployee) return;
    setAbsenceDraft({ staffId: selectedEmployee.id, fromDate: selectedDate, toDate: selectedDate, reason: 'Vacaciones', notes: '' });
    setError('');
  }

  async function saveAbsenceRange() {
    if (!absenceDraft || !operations) return;
    if (!canManageAbsences) return setError('Your role cannot create operational absence ranges.');
    if (absenceDraft.toDate < absenceDraft.fromDate) return setError('The absence end date cannot be before the start date.');
    const employee = employees.find((profile) => profile.id === absenceDraft.staffId);
    if (!employee) return setError('Select an active employee.');
    setBusy(true);
    setError('');
    try {
      const absence: CanonicalStaffAbsence = {
        id: `absence-${employee.id}-${absenceDraft.fromDate}-${crypto.randomUUID()}`,
        staffId: employee.id,
        fromDate: absenceDraft.fromDate,
        toDate: absenceDraft.toDate,
        reason: absenceDraft.reason,
        notes: absenceDraft.notes.trim() || undefined,
        active: true,
      };
      await saveCanonicalStaffAbsence(absence);
      setAbsenceDraft(null);
      setOperations(await loadCanonicalOperationsState());
      setMessage(`${staffDisplayName(employee)} absence saved: ${absence.fromDate} → ${absence.toDate}. Scheduling will treat the employee as unavailable for the range.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !operations) return <section className="panel" style={{ padding: 18 }}>Loading attendance calendar…</section>;
  if (!operations) return <section className="panel" style={{ padding: 18 }}><strong>Attendance unavailable.</strong><div>{error}</div></section>;
  if (!selectedEmployee) return <section className="panel" style={{ padding: 18 }}>No active employees are available.</section>;

  const selectedRecord = recordsFor(selectedEmployee, selectedDate);
  const linkedVan = employeeVan(selectedEmployee, operations.vans);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="panel">
        <header className="panel-head">
          <div><h2>Attendance Calendar</h2><span>Attendance, payroll exceptions and dispatch availability share one employee schedule and one absence source of truth.</span></div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button><button className="btn primary" type="button" onClick={openAbsenceRange} disabled={!canManageAbsences}>Add Absence Range</button></div>
        </header>
        {message ? <div style={styles.notice}><strong>{message}</strong></div> : null}
        {error ? <div style={styles.error}><strong>{error}</strong></div> : null}
        <div style={styles.controls}>
          <label style={styles.field}><strong>Employee</strong><select value={selectedEmployee.id} onChange={(event) => { setSelectedEmployeeId(event.target.value); setMessage(''); }}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)} · {employee.role ?? 'Unassigned role'}</option>)}</select></label>
          <div style={styles.identityCard}><strong>{staffDisplayName(selectedEmployee)}</strong><span>{selectedEmployee.role ?? 'Unassigned role'}{linkedVan ? ` · ${canonicalVanId(linkedVan.id, operations.vans)}` : ' · Unassigned'}</span></div>
        </div>
        <div style={styles.metrics}>
          <Metric label="Present" value={monthMetrics.present} /><Metric label="Late" value={monthMetrics.late} /><Metric label="Sick / AO" value={monthMetrics.sick} /><Metric label="Vacation" value={monthMetrics.vacation} /><Metric label="Absent / NWNP" value={monthMetrics.absent} />
        </div>
      </section>

      <section style={styles.layout}>
        <article className="panel" style={{ overflow: 'hidden' }}>
          <header className="panel-head"><div><h2>{monthLabel(month)}</h2><span>Select a day to review or record attendance.</span></div><div style={{ display: 'flex', gap: 8 }}><button className="btn" type="button" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><button className="btn" type="button" onClick={() => setMonth(monthKey(dateKey(new Date())))}>Today</button><button className="btn" type="button" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div></header>
          <div style={styles.weekdays}>{WEEKDAY_LABELS.map((label) => <strong key={label}>{label}</strong>)}</div>
          <div style={styles.calendar}>{monthCells.map((date, index) => {
            if (!date) return <div key={`empty-${index}`} style={styles.emptyDay} />;
            const record = recordsFor(selectedEmployee, date);
            return <button key={date} type="button" onClick={() => selectDate(date)} style={{ ...styles.day, ...(date === selectedDate ? styles.selectedDay : {}) }}><span style={{ fontWeight: 900 }}>{Number(date.slice(-2))}</span><small>{statusLabel(record.status)}</small>{record.entry?.lateMinutes ? <small>{record.entry.lateMinutes}m late</small> : null}{record.entry?.workedMinutes ? <small>{hoursAndMinutes(record.entry.workedMinutes)} worked</small> : null}</button>;
          })}</div>
        </article>

        <aside style={{ display: 'grid', gap: 18, alignSelf: 'start' }}>
          <article className="panel" style={{ padding: 18 }}>
            <div className="eyebrow">Daily Record</div><h2 style={{ marginTop: 4 }}>{formatDate(selectedDate)}</h2><p style={{ opacity: 0.72 }}>{selectedRecord.schedule.label}</p>
            {selectedRecord.absence && !selectedRecord.absence.id.startsWith('attendance-') ? <div style={styles.warning}><strong>Range absence applies</strong><div>{selectedRecord.absence.reason} · {selectedRecord.absence.fromDate} → {selectedRecord.absence.toDate}</div><small>The range record stays intact; daily payroll edits do not silently delete it.</small></div> : null}
            {draft ? <div style={{ display: 'grid', gap: 13, marginTop: 16 }}>
              <label style={styles.field}><strong>Status</strong><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as AttendanceStatus })}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_LABELS[status]}</option>)}</select></label>
              <div style={styles.twoCol}><label style={styles.field}><strong>Clock in</strong><input type="time" value={draft.clockInTime} onChange={(event) => setDraft({ ...draft, clockInTime: event.target.value })} /></label><label style={styles.field}><strong>Clock out</strong><input type="time" value={draft.clockOutTime} onChange={(event) => setDraft({ ...draft, clockOutTime: event.target.value })} /></label></div>
              <div style={styles.twoCol}><label style={styles.field}><strong>Break minutes</strong><input type="number" min="0" step="5" value={draft.breakMinutes} onChange={(event) => setDraft({ ...draft, breakMinutes: Number(event.target.value) })} /></label><label style={styles.field}><strong>Overtime minutes</strong><input type="number" min="0" step="5" value={draft.overtimeMinutes} onChange={(event) => setDraft({ ...draft, overtimeMinutes: Number(event.target.value) })} /></label></div>
              <label style={styles.field}><strong>Notes</strong><textarea rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
              <div style={styles.daySummary}><span>Scheduled</span><strong>{hoursAndMinutes(selectedRecord.schedule.scheduledMinutes)}</strong><span>Paid free</span><strong>{hoursAndMinutes(selectedRecord.schedule.paidFreeMinutes)}</strong><span>Existing late</span><strong>{hoursAndMinutes(selectedRecord.entry?.lateMinutes)}</strong><span>Existing worked</span><strong>{hoursAndMinutes(selectedRecord.entry?.workedMinutes)}</strong></div>
              <button className="btn primary" type="button" onClick={() => void saveDay()} disabled={busy || !canManageSensitiveAttendance}>{busy ? 'Saving…' : 'Save Daily Record'}</button>
              {!canManageSensitiveAttendance ? <small>Daily payroll-linked fields are read-only for this role. Operational absence ranges remain separate.</small> : null}
            </div> : null}
          </article>

          <article className="panel" style={{ padding: 18 }}><div className="eyebrow">Absence History</div><h3 style={{ marginTop: 4 }}>Recent / Scheduled Ranges</h3><div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{relevantAbsences.slice(0, 8).map((absence) => <div key={absence.id} style={styles.absenceRow}><strong>{absence.reason ?? 'Absence'}</strong><span>{absence.fromDate} → {absence.toDate}</span>{absence.notes ? <small>{absence.notes}</small> : null}</div>)}{!relevantAbsences.length ? <span style={{ opacity: 0.65 }}>No absence ranges recorded.</span> : null}</div></article>
        </aside>
      </section>

      {absenceDraft ? <div role="dialog" aria-modal="true" aria-label="Add absence range" style={styles.modalBackdrop}><div className="panel" style={styles.modal}><header className="panel-head"><div><h2>Add Absence Range</h2><span>One range updates dispatch availability for every covered date.</span></div><button className="btn" type="button" onClick={() => setAbsenceDraft(null)} disabled={busy}>Close</button></header><div style={styles.formGrid}>
        <label style={styles.field}><strong>Employee</strong><select value={absenceDraft.staffId} onChange={(event) => setAbsenceDraft({ ...absenceDraft, staffId: event.target.value })}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{staffDisplayName(employee)}</option>)}</select></label>
        <label style={styles.field}><strong>Type</strong><select value={absenceDraft.reason} onChange={(event) => setAbsenceDraft({ ...absenceDraft, reason: event.target.value })}>{ABSENCE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label style={styles.field}><strong>From</strong><input type="date" value={absenceDraft.fromDate} onChange={(event) => setAbsenceDraft({ ...absenceDraft, fromDate: event.target.value })} /></label>
        <label style={styles.field}><strong>To</strong><input type="date" value={absenceDraft.toDate} onChange={(event) => setAbsenceDraft({ ...absenceDraft, toDate: event.target.value })} /></label>
        <label style={{ ...styles.field, gridColumn: '1 / -1' }}><strong>Notes</strong><textarea rows={3} value={absenceDraft.notes} onChange={(event) => setAbsenceDraft({ ...absenceDraft, notes: event.target.value })} /></label>
      </div>{error ? <div style={styles.error}><strong>{error}</strong></div> : null}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}><button className="btn" type="button" onClick={() => setAbsenceDraft(null)} disabled={busy}>Cancel</button><button className="btn primary" type="button" onClick={() => void saveAbsenceRange()} disabled={busy}>{busy ? 'Saving…' : 'Save Absence Range'}</button></div></div></div> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article style={styles.metric}><span>{label}</span><strong>{value}</strong></article>;
}

const styles: Record<string, CSSProperties> = {
  notice: { margin: '12px 16px', padding: 12, border: '1px solid var(--line)', borderRadius: 12 },
  error: { margin: '12px 16px', padding: 12, border: '1px solid #dc6b6b', borderRadius: 12, background: 'rgba(220,107,107,.08)' },
  warning: { padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'rgba(209,143,24,.08)', display: 'grid', gap: 4 },
  controls: { display: 'grid', gridTemplateColumns: 'minmax(260px,420px) minmax(220px,1fr)', gap: 14, padding: 16, alignItems: 'end' },
  field: { display: 'grid', gap: 6 },
  identityCard: { display: 'grid', gap: 4, padding: 12, border: '1px solid var(--line)', borderRadius: 12 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(5,minmax(110px,1fr))', borderTop: '1px solid var(--line)' },
  metric: { display: 'grid', gap: 3, padding: 14, borderRight: '1px solid var(--line)' },
  layout: { display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) minmax(330px,.8fr)', gap: 18, alignItems: 'start' },
  weekdays: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, padding: '0 12px 8px', textAlign: 'center', opacity: 0.62 },
  calendar: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: 'var(--line)', borderTop: '1px solid var(--line)' },
  day: { minHeight: 108, border: 0, background: 'var(--panel, #fff)', padding: 10, display: 'grid', alignContent: 'start', gap: 5, textAlign: 'left', color: 'inherit', cursor: 'pointer' },
  selectedDay: { outline: '2px solid var(--accent, #1e66f5)', outlineOffset: '-2px', position: 'relative', zIndex: 1 },
  emptyDay: { minHeight: 108, background: 'var(--surface-subtle, rgba(127,127,127,.04))' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  daySummary: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '7px 12px', padding: 12, border: '1px solid var(--line)', borderRadius: 12 },
  absenceRow: { display: 'grid', gap: 2, padding: 10, border: '1px solid var(--line)', borderRadius: 10 },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(2,10,23,.62)' },
  modal: { width: 'min(700px,100%)', maxHeight: '90vh', overflow: 'auto', padding: 20 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginTop: 16 },
};
