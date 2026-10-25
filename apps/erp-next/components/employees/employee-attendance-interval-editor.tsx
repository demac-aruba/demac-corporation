'use client';

import type { AttendanceDayDraft, AttendanceWorkInterval, EmployeeTimesheetEntry, OvertimePayAllocation } from '@/lib/employee-attendance';
import { overtimeRateTotals } from '@/lib/employee-attendance-calculation';
import styles from './employee-attendance-command-center.module.css';

type Props = {
  draft: AttendanceDayDraft;
  onChange: (draft: AttendanceDayDraft) => void;
  overtimeMinutes: number;
  excludedGapMinutes?: number;
  existing?: EmployeeTimesheetEntry;
  disabled: boolean;
};

const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

export function EmployeeAttendanceIntervalEditor({ draft, onChange, overtimeMinutes, excludedGapMinutes, existing, disabled }: Props) {
  const intervals = draft.workIntervals;
  const allocations = draft.overtimePayAllocations;
  const totals = overtimeRateTotals({ overtimeMinutes, overtimePayAllocations: allocations });
  const activeMode = !allocations ? '' : allocations.length === 1 ? String(allocations[0].rate) : 'split';
  function updateIntervals(next: AttendanceWorkInterval[]) {
    const first = next[0];
    onChange({ ...draft, workIntervals: next, clockInTime: first.startTime, clockOutTime: first.endTime, breakMinutes: first.breakMinutes, overtimePayAllocations: undefined });
  }
  function updateInterval(index: number, changes: Partial<AttendanceWorkInterval>) {
    if (intervals) updateIntervals(intervals.map((row, i) => i === index ? { ...row, ...changes } : row));
  }
  function setRates(next: OvertimePayAllocation[]) { onChange({ ...draft, overtimePayAllocations: next }); }
  return <fieldset className={styles.intervalEditor} disabled={disabled}>
    <label className={styles.splitToggle}><input type="checkbox" checked={!!intervals?.length} disabled={!!existing?.workIntervals?.length} onChange={(event) => {
      if (!event.target.checked) { onChange({ ...draft, workIntervals: undefined, overtimePayAllocations: undefined }); return; }
      updateIntervals([{ startTime: draft.clockInTime, endTime: draft.clockOutTime, startDayOffset: 0, endDayOffset: 0, breakMinutes: draft.breakMinutes }, { startTime: '', endTime: '', startDayOffset: 0, endDayOffset: 0, breakMinutes: 0 }]);
    }} /><span><strong>Split shift / additional work interval</strong><small>Record a return to work without counting the time between shifts.</small></span></label>
    {intervals?.length ? <section className={styles.intervalSection}>
      <div className={styles.intervalTitle}><strong>Work intervals</strong><button type="button" disabled={intervals.length >= 12} onClick={() => updateIntervals([...intervals, { startTime: '', endTime: '', startDayOffset: 0, endDayOffset: 0, breakMinutes: 0 }])}>+ Add interval</button></div>
      {intervals.map((row, index) => <div className={styles.intervalCard} key={index}>
        <div className={styles.intervalTitle}><strong>{index + 1}. {index === 0 ? 'First work interval' : 'Additional work / overtime'}</strong>{index > 0 ? <button type="button" aria-label={`Remove interval ${index + 1}`} onClick={() => updateIntervals(intervals.filter((_, i) => i !== index))}>Remove</button> : null}</div>
        <div className={styles.intervalFields}>
          <label className={styles.field}><span>Clock In</span><input className={styles.control} aria-label={`Interval ${index + 1} Clock In`} type="time" value={row.startTime} onChange={(e) => updateInterval(index, { startTime: e.target.value })} /></label>
          <label className={styles.field}><span>Clock Out</span><input className={styles.control} aria-label={`Interval ${index + 1} Clock Out`} type="time" value={row.endTime} onChange={(e) => updateInterval(index, { endTime: e.target.value })} /></label>
          <label className={styles.field}><span>Break (min)</span><input className={styles.control} aria-label={`Interval ${index + 1} Break Minutes`} type="number" min="0" step="1" value={row.breakMinutes} onChange={(e) => updateInterval(index, { breakMinutes: Number(e.target.value) })} /></label>
        </div>
        <div className={styles.intervalDates}>{index > 0 ? <label><input type="checkbox" checked={row.startDayOffset === 1} onChange={(e) => updateInterval(index, { startDayOffset: e.target.checked ? 1 : 0, ...(e.target.checked ? { endDayOffset: 1 as const } : {}) })} />Clock in next day</label> : <span>Starts on selected date</span>}<label><input type="checkbox" aria-label={`Interval ${index + 1} Clock out next day`} checked={row.endDayOffset === 1} onChange={(e) => updateInterval(index, { endDayOffset: e.target.checked ? 1 : 0 })} />Clock out next day</label></div>
      </div>)}
      <p className={styles.intervalHint}>Time between intervals excluded: <strong>{duration(excludedGapMinutes ?? 0)}</strong>. Overnight work belongs to the starting payroll date.</p>
    </section> : null}
    {overtimeMinutes > 0 || allocations !== undefined ? <section className={styles.intervalSection}>
      <div className={styles.intervalTitle}><strong>Overtime pay rates</strong><span>{duration(overtimeMinutes)} total</span></div>
      <div className={styles.rateModes}>{([['150', 'All at 150%'], ['200', 'All at 200%'], ['split', 'Split rates']] as const).map(([mode, label]) => <button type="button" aria-pressed={activeMode === mode} key={mode} onClick={() => setRates(mode === 'split' ? [{ rate: 150, minutes: 0 }, { rate: 200, minutes: 0 }] : overtimeMinutes ? [{ rate: Number(mode) as 150 | 200, minutes: overtimeMinutes }] : [])}>{label}</button>)}</div>
      {!allocations ? <p className={styles.intervalHint}>No rate selected. Existing overtime remains unassigned until you explicitly choose a rate.</p> : null}
      {allocations?.map((row, index) => <div className={styles.rateFields} key={index}>
        <label className={styles.field}><span>Hours</span><input className={styles.control} aria-label={`Allocation ${index + 1} hours`} type="number" min="0" step="1" value={Math.floor(row.minutes / 60)} onChange={(e) => setRates(allocations.map((r, i) => i === index ? { ...r, minutes: Number(e.target.value) * 60 + r.minutes % 60 } : r))} /></label>
        <label className={styles.field}><span>Minutes</span><input className={styles.control} aria-label={`Allocation ${index + 1} minutes`} type="number" min="0" max="59" step="1" value={row.minutes % 60} onChange={(e) => setRates(allocations.map((r, i) => i === index ? { ...r, minutes: Math.floor(r.minutes / 60) * 60 + Number(e.target.value) } : r))} /></label>
        <label className={styles.field}><span>Pay rate</span><select className={styles.control} aria-label={`Allocation ${index + 1} rate`} value={row.rate} onChange={(e) => setRates(allocations.map((r, i) => i === index ? { ...r, rate: Number(e.target.value) as 150 | 200 } : r))}><option value="150">150%</option><option value="200">200%</option></select></label>
      </div>)}
      <p className={styles.intervalHint}>Assigned: <strong>{duration(totals.at150 + totals.at200)} / {duration(overtimeMinutes)}</strong>. Allocate net overtime hours after breaks; clock times stay unchanged.</p>
    </section> : null}
    {intervals?.length || allocations !== undefined ? <label className={styles.field}><span>Reason for this change (required)</span><textarea className={`${styles.control} ${styles.notes}`} value={draft.changeReason ?? ''} onChange={(event) => onChange({ ...draft, changeReason: event.target.value })} placeholder="Reason for split shift or approved overtime rate…" /></label> : null}
  </fieldset>;
}
