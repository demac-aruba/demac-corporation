const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateAttendanceVariance,
  calculateAttendanceVarianceWithWorkSegments,
} = require('./employeeAttendanceCalculation');

const schedule = { startTime: '08:00', endTime: '17:00', scheduledMinutes: 480 };

function segment(startTime, endTime, endDate = '2026-08-27') {
  return {
    workOrderId: 'WO-AH-1',
    startDate: '2026-08-27',
    startTime,
    endDate,
    endTime,
  };
}

test('base attendance variance remains schedule-derived with no external segments', () => {
  const result = calculateAttendanceVariance({ schedule, clockInTime: '08:00', clockOutTime: '18:00', breakMinutes: 60 });
  assert.equal(result.overtimeMinutes, 60);
  assert.equal(result.workedMinutes, 540);
});

test('disjoint after-hours evidence adds only its real interval and never the gap after Clock Out', () => {
  const result = calculateAttendanceVarianceWithWorkSegments({
    workDate: '2026-08-27',
    schedule,
    clockInTime: '08:00',
    clockOutTime: '17:00',
    breakMinutes: 60,
    workSegments: [segment('17:30', '19:15')],
  });
  assert.equal(result.overtimeMinutes, 105);
  assert.equal(result.workSegmentOvertimeMinutes, 105);
  assert.equal(result.workSegmentMinutes, 105);
});

test('overlap between Clock In/Out and Work Order evidence is counted once', () => {
  const result = calculateAttendanceVarianceWithWorkSegments({
    workDate: '2026-08-27',
    schedule,
    clockInTime: '08:00',
    clockOutTime: '18:00',
    breakMinutes: 60,
    workSegments: [segment('17:30', '19:15')],
  });
  assert.equal(result.overtimeMinutes, 135);
  assert.equal(result.workSegmentOvertimeMinutes, 75);
});

test('evidence already fully inside the attendance interval is not added twice', () => {
  const result = calculateAttendanceVarianceWithWorkSegments({
    workDate: '2026-08-27',
    schedule,
    clockInTime: '08:00',
    clockOutTime: '19:15',
    breakMinutes: 60,
    workSegments: [segment('17:30', '19:15')],
  });
  assert.equal(result.overtimeMinutes, 135);
  assert.equal(result.workSegmentOvertimeMinutes, 0);
});

test('cross-midnight after-hours evidence is attributed to the originating work date', () => {
  const result = calculateAttendanceVarianceWithWorkSegments({
    workDate: '2026-08-27',
    schedule,
    clockInTime: '',
    clockOutTime: '',
    breakMinutes: 0,
    workSegments: [segment('17:30', '00:30', '2026-08-28')],
  });
  assert.equal(result.overtimeMinutes, 420);
  assert.equal(result.workSegmentOvertimeMinutes, 420);
  assert.equal(result.workedMinutes, 420);
});

test('duplicate or overlapping external evidence is unioned before overtime is calculated', () => {
  const result = calculateAttendanceVarianceWithWorkSegments({
    workDate: '2026-08-27',
    schedule,
    clockInTime: '',
    clockOutTime: '',
    breakMinutes: 0,
    workSegments: [
      segment('17:30', '19:15'),
      { ...segment('18:00', '20:00'), workOrderId: 'WO-AH-2' },
    ],
  });
  assert.equal(result.overtimeMinutes, 150);
  assert.equal(result.workedMinutes, 150);
});
