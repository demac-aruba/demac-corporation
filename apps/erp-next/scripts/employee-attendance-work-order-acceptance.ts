import assert from 'node:assert/strict';
import {
  calculateAttendanceVariance,
  calculateAttendanceVarianceWithWorkSegments,
  type AttendanceScheduleForCalculation,
  type AttendanceWorkSegment,
} from '../lib/employee-attendance-calculation';

const schedule: AttendanceScheduleForCalculation = {
  startTime: '08:00',
  endTime: '17:00',
  scheduledMinutes: 480,
};

const emergency: AttendanceWorkSegment = {
  workOrderId: 'WO-AH-1',
  appointmentId: 'APT-AH-1',
  kind: 'after_hours_emergency',
  startDate: '2026-08-27',
  startTime: '17:30',
  endDate: '2026-08-27',
  endTime: '19:15',
};

assert.equal(
  calculateAttendanceVariance({ schedule, clockInTime: '08:00', clockOutTime: '18:00', breakMinutes: 60 }).overtimeMinutes,
  60,
  'The shared authority must preserve the existing schedule-derived overtime rule.',
);

const gapSafe = calculateAttendanceVarianceWithWorkSegments({
  workDate: '2026-08-27',
  schedule,
  clockInTime: '08:00',
  clockOutTime: '17:00',
  breakMinutes: 60,
  workSegments: [emergency],
});
assert.equal(gapSafe.overtimeMinutes, 105, '17:00–17:30 must not become worked time merely because an emergency starts at 17:30.');

const partialOverlap = calculateAttendanceVarianceWithWorkSegments({
  workDate: '2026-08-27',
  schedule,
  clockInTime: '08:00',
  clockOutTime: '18:00',
  breakMinutes: 60,
  workSegments: [emergency],
});
assert.equal(partialOverlap.overtimeMinutes, 135, 'Attendance and Work Order evidence must be unioned without double counting 17:30–18:00.');

const covered = calculateAttendanceVarianceWithWorkSegments({
  workDate: '2026-08-27',
  schedule,
  clockInTime: '08:00',
  clockOutTime: '19:15',
  breakMinutes: 60,
  workSegments: [emergency],
});
assert.equal(covered.overtimeMinutes, 135, 'A Work Order interval already covered by Clock In/Out must add zero duplicate overtime.');

const crossMidnight = calculateAttendanceVarianceWithWorkSegments({
  workDate: '2026-08-27',
  schedule,
  clockInTime: '',
  clockOutTime: '',
  breakMinutes: 0,
  workSegments: [{ ...emergency, endDate: '2026-08-28', endTime: '00:30' }],
});
assert.equal(crossMidnight.overtimeMinutes, 420, 'Cross-midnight emergency evidence must remain attached to the originating work date.');

console.log('Employee attendance Work Order integration acceptance passed.');
