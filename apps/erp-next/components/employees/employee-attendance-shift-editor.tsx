'use client';

import type { AttendanceDayDraft, AttendanceSchedule, EmployeeTimesheetEntry } from '@/lib/employee-attendance';
import { buildAttendanceShiftOverride } from '@/lib/employee-attendance';
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
    <label className={styles.splitToggle}><input type="checkbox" checked={!!shift} disabled={!!existing?.attendanceShiftOverride || schedule.scheduledMinutes <= 0} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: event.target.checked ? buildAttendanceShiftOverride(schedule, draft.clockInTime || schedule.startTime, scheduledBreakMinutes(schedule)) : undefined })} /><span><strong>Adjust scheduled shift for this day</strong><small>Confirm a different planned start for this date. Regular hours stay the same.</small></span></label>
    {shift ? <section className={styles.intervalSection}>
      <div className={styles.intervalFields}>
        <label className={styles.field}><span>Scheduled start</span><input className={styles.control} type="time" value={shift.startTime} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: buildAttendanceShiftOverride(schedule, event.target.value, shift.breakMinutes) })} /></label>
        <label className={styles.field}><span>Scheduled end (automatic)</span><input className={styles.control} type="time" value={shift.endTime} readOnly /></label>
        <label className={styles.field}><span>Planned unpaid break (min)</span><input className={styles.control} type="number" min="0" max={1440 - schedule.scheduledMinutes} step="1" value={shift.breakMinutes} onChange={(event) => onChange({ ...draft, attendanceShiftOverride: buildAttendanceShiftOverride(schedule, shift.startTime, Number(event.target.value)) })} /></label>
      </div>
      <p className={styles.intervalHint}>Planned regular shift: <strong>{schedule.scheduledMinutes / 60} work hours</strong> + {shift.breakMinutes} minutes of unpaid break. {shift.endTime ? `Ends at ${shift.endTime}${shift.endDayOffset ? ' on the next day' : ' on the same day'}.` : 'Enter a valid planned start and break.'}</p>
      <p className={styles.intervalHint}>The planned end is calculated automatically. Enter the actual finish and only the break actually taken below. Working through the unpaid break counts as work, not paid leave.</p>
    </section> : null}
  </fieldset>;
}
