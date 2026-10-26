'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateAttendanceVarianceWithWorkSegments: calculate, normalizeAttendanceIntervals, validateOvertimePayAllocations, overtimeRateTotals } = require('./employeeAttendanceCalculation');
const schedule = { startTime: '08:00', endTime: '17:00', scheduledMinutes: 480 };
const row = (startTime, endTime, breakMinutes = 0, endDayOffset = 0, startDayOffset = 0) => ({ startTime, endTime, breakMinutes, startDayOffset, endDayOffset });
const workIntervals = [row('08:00', '17:00', 60), row('19:30', '05:00', 0, 1)];
const input = { workDate: '2026-10-26', schedule, clockInTime: '08:00', clockOutTime: '17:00', breakMinutes: 60, workIntervals };

test('owner example: separate shifts, overnight, net breaks and exact rate minutes', () => {
  const result = calculate(input);
  assert.equal(result.workedMinutes, 1050);
  assert.equal(result.overtimeMinutes, 570);
  assert.equal(result.missingScheduledMinutes, 0);
  assert.equal(result.excludedGapMinutes, 150);
  const allocations = [{ rate: 150, minutes: 150 }, { rate: 200, minutes: 420 }];
  assert.deepEqual(validateOvertimePayAllocations(allocations, 570), allocations);
  assert.deepEqual(overtimeRateTotals({ overtimeMinutes: 570, overtimePayAllocations: allocations }), { at150: 150, at200: 420, unassigned: 0, requiresReview: false });
});
test('regular split gap does not invent work, unused lunch, or offset missing regular hours with overtime', () => {
  const result = calculate({ ...input, workIntervals: [row('08:00', '12:00'), row('14:00', '17:00'), row('20:00', '23:00')] });
  assert.equal(result.workedMinutes, 600);
  assert.equal(result.overtimeMinutes, 180);
  assert.equal(result.missingScheduledMinutes, 60);
  assert.deepEqual(result.missingSegments, [{ kind: 'partial_day', minutes: 60 }]);
});
test('normal lunch split and split on a day off', () => {
  const normal = calculate({ ...input, workIntervals: [row('08:00', '12:00'), row('13:00', '17:00')] });
  assert.equal(normal.workedMinutes, 480); assert.equal(normal.overtimeMinutes, 0); assert.equal(normal.missingScheduledMinutes, 0);
  const off = calculate({ ...input, schedule: { startTime: '', endTime: '', scheduledMinutes: 0 }, workIntervals: [row('20:00', '02:00', 30, 1)] });
  assert.equal(off.overtimeMinutes, 330); assert.equal(off.workedMinutes, 330);
});
test('breaks are deducted from their own intervals and boundary dates do not change durations', () => {
  for (const workDate of ['2026-10-26', '2026-12-31', '2028-02-29']) {
    const result = calculate({ ...input, workDate, workIntervals: [row('08:00', '17:00', 60), row('19:30', '05:00', 45, 1)] });
    assert.equal(result.overtimeMinutes, 525); assert.equal(result.workedMinutes, 1005);
  }
});
test('invalid, overlapping, too-long and ambiguous intervals reject without normalization loss', () => {
  for (const intervals of [[], [row('08:00', '08:00')], [row('19:00', '05:00')], [row('08:00', '17:00', -1)], [row('08:00', '17:00', 540)], [row('08:00', '17:00', 1.5)], [row('08:00', '17:00'), row('16:59', '18:00')], [row('23:00', '25:00')], [row('08:00', '09:00', 0, 1)], [row('00:00', '05:00', 0, 1, 1)]]) assert.throws(() => normalizeAttendanceIntervals(intervals));
  assert.equal(normalizeAttendanceIntervals([row('08:00', '12:00'), row('12:00', '17:00')]).length, 2);
});
test('work order evidence union excludes double-counting and off-duty gaps', () => {
  const segment = { workOrderId: 'synthetic-wo', startDate: input.workDate, startTime: '19:30', endDate: '2026-10-27', endTime: '05:00' };
  const same = calculate({ ...input, workSegments: [segment, segment] });
  assert.equal(same.overtimeMinutes, 570); assert.equal(same.workSegmentMinutes, 0);
  const extra = calculate({ ...input, workSegments: [{ ...segment, startTime: '18:30', endDate: input.workDate, endTime: '20:30' }] });
  assert.equal(extra.overtimeMinutes, 630); assert.equal(extra.workSegmentMinutes, 60);
});
test('regular and newly evidenced overtime default to 150% without changing explicit rates or records', () => {
  const old = Object.freeze({ overtimeHours: 7.75 });
  assert.deepEqual(overtimeRateTotals(old), { at150: 465, at200: 0, unassigned: 0, requiresReview: false });
  assert.deepEqual(overtimeRateTotals({ overtimeMinutes: 600, overtimePayAllocations: [{ rate: 200, minutes: 570 }] }), { at150: 30, at200: 570, unassigned: 0, requiresReview: false });
  assert.equal(overtimeRateTotals({ overtimeMinutes: 300, overtimePayAllocations: [{ rate: 200, minutes: 570 }] }).requiresReview, true);
});
test('allocation totals, percentages and integer-minute precision are enforced', () => {
  for (const allocation of [[{ rate: 150, minutes: 569 }], [{ rate: 200, minutes: 571 }], [{ rate: 175, minutes: 570 }], [{ rate: 200, minutes: -1 }], [{ rate: 150, minutes: 569.5 }], []]) assert.throws(() => validateOvertimePayAllocations(allocation, 570));
  assert.deepEqual(validateOvertimePayAllocations([], 0), []);
});

test('owner payroll example defaults 37h55 to regular and preserves 9h30 special', () => {
  const record = Object.freeze({ overtimeMinutes: 2845, overtimePayAllocations: Object.freeze([Object.freeze({ rate: 200, minutes: 570 })]) });
  assert.deepEqual(overtimeRateTotals(record), { at150: 2275, at200: 570, unassigned: 0, requiresReview: false });
  assert.deepEqual(record.overtimePayAllocations, [{ rate: 200, minutes: 570 }]);
  for (const overtimePayAllocations of [undefined, null, []]) {
    assert.deepEqual(overtimeRateTotals({ overtimeMinutes: 570, overtimePayAllocations }), { at150: 570, at200: 0, unassigned: 0, requiresReview: false });
  }
  assert.deepEqual(overtimeRateTotals({ overtimeMinutes: 600, overtimePayAllocations: [{ rate: 150, minutes: 30 }, { rate: 200, minutes: 570 }] }), { at150: 30, at200: 570, unassigned: 0, requiresReview: false });
  assert.deepEqual(overtimeRateTotals({ overtimeMinutes: 0 }), { at150: 0, at200: 0, unassigned: 0, requiresReview: false });
});
test('invalid explicit allocations remain reviewable instead of receiving an assumed rate', () => {
  for (const overtimePayAllocations of [{ rate: 200, minutes: 570 }, [null], [{ rate: 175, minutes: 10 }], [{ rate: 200, minutes: -1 }]]) {
    assert.deepEqual(overtimeRateTotals({ overtimeMinutes: 570, overtimePayAllocations }), { at150: 0, at200: 0, unassigned: 570, requiresReview: true });
  }
  assert.deepEqual(overtimeRateTotals({ overtimeMinutes: 300, overtimePayAllocations: [{ rate: 200, minutes: 570 }] }), { at150: 0, at200: 570, unassigned: 0, requiresReview: true });
});
