const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateAttendanceVariance,
  calculateAttendanceVarianceWithWorkSegments,
  classifyAttendanceExceptions,
} = require('./employeeAttendanceCalculation');

const schedule = { startTime: '08:00', endTime: '17:00', scheduledMinutes: 480 };

for (const [clockOutTime, breakMinutes, worked, overtime, missing, applied] of [
  ['16:00', 0, 480, 0, 0, 60],
  ['16:30', 0, 510, 30, 0, 30],
  ['17:00', 0, 540, 60, 0, 0],
  ['15:30', 0, 450, 0, 30, 60],
  ['12:00', 0, 240, 0, 240, 60],
  ['16:30', 30, 480, 0, 0, 30],
  ['16:00', 30, 450, 0, 30, 30],
  ['16:30', 60, 450, 0, 30, 0],
  ['17:00', 60, 480, 0, 0, 0],
  ['16:30', 90, 420, 0, 60, 0],
  ['16:59', 0, 539, 59, 0, 1],
  ['16:01', 0, 481, 1, 0, 59],
]) {
  test(`08:00 to ${clockOutTime}, break ${breakMinutes}: offset only available break`, () => {
    const result = calculateAttendanceVariance({ schedule, clockInTime: '08:00', clockOutTime, breakMinutes });
    assert.equal(result.workedMinutes, worked);
    assert.equal(result.overtimeMinutes, overtime);
    assert.equal(result.missingScheduledMinutes, missing);
    assert.equal(result.breakAppliedToEarlyDepartureMinutes, applied);
    assert.equal(480 - result.missingScheduledMinutes + result.overtimeMinutes, worked);
    if (!missing) assert.deepEqual(classifyAttendanceExceptions(result, []), []);
    else assert.throws(() => classifyAttendanceExceptions(result, []), /Choose Paid or No Work No Pay/);
  });
}

test('only the uncovered departure interval is classified, with the break at the end', () => {
  const result = calculateAttendanceVariance({ schedule, clockInTime: '08:00', clockOutTime: '15:30', breakMinutes: 0 });
  assert.deepEqual(result.missingSegments, [
    { kind: 'early_departure', minutes: 30, fromTime: '15:30', toTime: '16:00' },
  ]);
});

test('shifted break does not erase lateness or offset genuine early-start overtime', () => {
  const late = calculateAttendanceVariance({ schedule, clockInTime: '08:30', clockOutTime: '16:30', breakMinutes: 0 });
  assert.equal(late.overtimeMinutes, 30);
  assert.deepEqual(late.missingSegments, [{ kind: 'late_arrival', minutes: 30, fromTime: '08:00', toTime: '08:30' }]);
  const early = calculateAttendanceVariance({ schedule, clockInTime: '07:00', clockOutTime: '15:30', breakMinutes: 0 });
  assert.equal(early.overtimeMinutes, 60);
  assert.equal(early.missingScheduledMinutes, 30);
});

test('compensation follows configured break allowance, including partial days', () => {
  const custom = { startTime: '09:00', endTime: '18:00', scheduledMinutes: 495 };
  const result = calculateAttendanceVariance({ schedule: custom, clockInTime: '09:00', clockOutTime: '17:30', breakMinutes: 0 });
  assert.equal(result.overtimeMinutes, 15);
  assert.equal(result.missingScheduledMinutes, 0);
  const partial = calculateAttendanceVariance({ schedule: { startTime: '08:00', endTime: '12:00', scheduledMinutes: 240 }, clockInTime: '08:00', clockOutTime: '11:30', breakMinutes: 0 });
  assert.equal(partial.breakAppliedToEarlyDepartureMinutes, 0);
  assert.equal(partial.missingScheduledMinutes, 30);
});

test('invalid or wholly out-of-shift clock ranges cannot receive regular credit', () => {
  for (const [clockInTime, clockOutTime] of [['', ''], ['16:00', '08:00'], ['07:00', '08:00'], ['18:00', '19:00']]) {
    const result = calculateAttendanceVariance({ schedule, clockInTime, clockOutTime, breakMinutes: 0 });
    assert.equal(result.breakAppliedToEarlyDepartureMinutes, 0);
    assert.ok(result.overtimeMinutes <= result.workedMinutes);
    if (clockInTime === '07:00' || clockInTime === '18:00') assert.equal(result.missingScheduledMinutes, 480);
  }
});

test('after-hours evidence preserves break compensation and counts each interval once', () => {
  const input = { workDate: '2026-08-27', schedule, clockInTime: '08:00', clockOutTime: '16:30', breakMinutes: 0,
    workSegments: [segment('17:30', '18:30'), segment('17:30', '18:30')] };
  const result = calculateAttendanceVarianceWithWorkSegments(input);
  assert.equal(result.workedMinutes, 570);
  assert.equal(result.overtimeMinutes, 90);
  assert.equal(result.missingScheduledMinutes, 0);
});

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
