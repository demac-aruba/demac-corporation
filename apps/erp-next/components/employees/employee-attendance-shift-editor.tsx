'use client';

import type { AttendanceDayDraft, AttendanceSchedule, EmployeeTimesheetEntry } from '@/lib/employee-attendance';
import { scheduledBreakMinutes } from '@/lib/employee-attendance-calculation';
import styles from './employee-attendance-command-center.module.css';

export function EmployeeAttendanceShiftEditor({ draft, schedule, existing, disabled, onChange }: {
  draft: AttendanceDayDraft;
  schedule: AttendanceSchedule;
  existing?: EmployeeTimesheetEntry;
  disabled: boolean;
  onChange: (draft: AttendanceDayDraft) => void;
}) {
  const shift = draft.attendanceShiftOverride;
  return <fieldset className={styles.intervalEditor} disabled={disabled}>
    <label className={styles.splitToggle}><input type="checkbox" checked={!!shift} disabled={!!existing?.attendanceShiftOverride} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: event.target.checked ? { startTime: schedule.startTime, endTime: schedule.endTime, endDayOffset: schedule.endDayOffset ?? 0, breakMinutes: scheduledBreakMinutes(schedule) } : undefined })} /><span><strong>Adjust scheduled shift for this day</strong><small>Use when the employee was scheduled to start at a different time on this date.</small></span></label>
    {shift ? <section className={styles.intervalSection}>
      <div className={styles.intervalFields}>
        <label className={styles.field}><span>Scheduled start</span><input className={styles.control} type="time" value={shift.startTime} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: { ...shift, startTime: event.target.value } })} /></label>
        <label className={styles.field}><span>Scheduled end</span><input className={styles.control} type="time" value={shift.endTime} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: { ...shift, endTime: event.target.value } })} /></label>
        <label className={styles.field}><span>Scheduled break (min)</span><input className={styles.control} type="number" min="0" step="1" value={shift.breakMinutes} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: { ...shift, breakMinutes: Number(event.target.value) } })} /></label>
      </div>
      <label className={styles.dayOffsetToggle}><input type="checkbox" checked={shift.endDayOffset === 1} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: { ...shift, endDayOffset: event.target.checked ? 1 : 0 } })} />Scheduled end is next day</label>
      <p className={styles.intervalHint}>Keep the same {schedule.scheduledMinutes / 60} regular hours. This adjustment applies only to this attendance date; the recurring schedule stays unchanged. Record the break actually taken below.</p>
    </section> : null}
  </fieldset>;
}
