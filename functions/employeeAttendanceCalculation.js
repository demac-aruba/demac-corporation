'use strict';

function minutesOfDay(value) {
  const [hour, minute] = String(value || '').split(':').map(Number);
  if (![hour, minute].every(Number.isFinite)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function minutesBetween(startTime, endTime) {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  if (start === undefined || end === undefined) return 0;
  return Math.max(0, end - start);
}

function workedMinutes(clockInTime, clockOutTime, breakMinutes = 0) {
  if (!clockInTime || !clockOutTime) return 0;
  return Math.max(0, minutesBetween(clockInTime, clockOutTime) - Math.max(0, Math.round(Number(breakMinutes) || 0)));
}

function scheduledBreakMinutes(schedule) {
  if (!schedule?.startTime || !schedule?.endTime || Number(schedule?.scheduledMinutes) <= 0) return 0;
  return Math.max(0, minutesBetween(schedule.startTime, schedule.endTime) - Math.max(0, Number(schedule.scheduledMinutes) || 0));
}

function hasValidWorkedTimeRange(clockInTime, clockOutTime) {
  const start = minutesOfDay(clockInTime);
  const end = minutesOfDay(clockOutTime);
  return start !== undefined && end !== undefined && end > start;
}

function emptyVariance(expectedBreakMinutes, workedMinutesValue) {
  return {
    expectedBreakMinutes,
    workedMinutes: workedMinutesValue,
    earlyStartMinutes: 0,
    lateFinishMinutes: 0,
    unusedBreakMinutes: 0,
    overtimeMinutes: 0,
    lateArrivalMinutes: 0,
    earlyDepartureMinutes: 0,
    extendedBreakMinutes: 0,
    missingScheduledMinutes: 0,
    missingSegments: [],
  };
}

function calculateAttendanceVariance(input) {
  const { schedule = {}, clockInTime = '', clockOutTime = '' } = input || {};
  const actualBreakMinutes = Math.max(0, Math.round(Number(input?.breakMinutes) || 0));
  const expectedBreakMinutes = scheduledBreakMinutes(schedule);
  const workedMinutesValue = workedMinutes(clockInTime, clockOutTime, actualBreakMinutes);
  const scheduleStart = minutesOfDay(schedule.startTime);
  const scheduleEnd = minutesOfDay(schedule.endTime);
  const actualStart = minutesOfDay(clockInTime);
  const actualEnd = minutesOfDay(clockOutTime);

  if (
    Number(schedule.scheduledMinutes) <= 0
    || scheduleStart === undefined
    || scheduleEnd === undefined
    || scheduleEnd <= scheduleStart
    || actualStart === undefined
    || actualEnd === undefined
    || actualEnd <= actualStart
  ) {
    return emptyVariance(expectedBreakMinutes, workedMinutesValue);
  }

  const earlyStartMinutes = actualStart < scheduleStart
    ? Math.max(0, Math.min(actualEnd, scheduleStart) - actualStart)
    : 0;
  const lateFinishMinutes = actualEnd > scheduleEnd
    ? Math.max(0, actualEnd - Math.max(actualStart, scheduleEnd))
    : 0;
  const unusedBreakMinutes = Math.max(0, expectedBreakMinutes - actualBreakMinutes);
  const rawOvertimeMinutes = earlyStartMinutes + lateFinishMinutes + unusedBreakMinutes;
  const overtimeMinutes = Math.min(workedMinutesValue, rawOvertimeMinutes);

  const rawLateArrivalMinutes = actualStart > scheduleStart
    ? Math.max(0, Math.min(actualStart, scheduleEnd) - scheduleStart)
    : 0;
  const lateArrivalMinutes = Math.min(Number(schedule.scheduledMinutes) || 0, rawLateArrivalMinutes);
  const remainingAfterLateArrival = Math.max(0, (Number(schedule.scheduledMinutes) || 0) - lateArrivalMinutes);

  const rawEarlyDepartureMinutes = actualEnd < scheduleEnd
    ? Math.max(0, scheduleEnd - Math.max(actualEnd, scheduleStart))
    : 0;
  const earlyDepartureMinutes = Math.min(remainingAfterLateArrival, rawEarlyDepartureMinutes);
  const remainingAfterClockGaps = Math.max(0, remainingAfterLateArrival - earlyDepartureMinutes);

  const extendedBreakMinutes = Math.min(
    remainingAfterClockGaps,
    Math.max(0, actualBreakMinutes - expectedBreakMinutes),
  );
  const missingScheduledMinutes = lateArrivalMinutes + earlyDepartureMinutes + extendedBreakMinutes;

  const missingSegments = [];
  if (lateArrivalMinutes > 0) {
    missingSegments.push({
      kind: 'late_arrival',
      minutes: lateArrivalMinutes,
      fromTime: schedule.startTime,
      toTime: actualStart >= scheduleEnd ? schedule.endTime : clockInTime,
    });
  }
  if (earlyDepartureMinutes > 0) {
    missingSegments.push({
      kind: 'early_departure',
      minutes: earlyDepartureMinutes,
      fromTime: actualEnd <= scheduleStart ? schedule.startTime : clockOutTime,
      toTime: schedule.endTime,
    });
  }
  if (extendedBreakMinutes > 0) missingSegments.push({ kind: 'extended_break', minutes: extendedBreakMinutes });

  return {
    expectedBreakMinutes,
    workedMinutes: workedMinutesValue,
    earlyStartMinutes,
    lateFinishMinutes,
    unusedBreakMinutes,
    overtimeMinutes,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    extendedBreakMinutes,
    missingScheduledMinutes,
    missingSegments,
  };
}

function attendanceExceptionKindLabel(kind) {
  if (kind === 'late_arrival') return 'late arrival';
  if (kind === 'early_departure') return 'early departure';
  return 'extended break';
}

function classifyAttendanceExceptions(variance, classifications) {
  const byKind = new Map((classifications || []).map((classification) => [classification.kind, classification]));
  return (variance?.missingSegments || []).map((segment) => {
    const classification = byKind.get(segment.kind);
    if (!classification?.treatment) throw new Error(`Choose Paid or No Work No Pay for ${attendanceExceptionKindLabel(segment.kind)}.`);
    const reason = String(classification.reason || '').trim();
    if (!reason) throw new Error(`Enter a reason for ${attendanceExceptionKindLabel(segment.kind)}.`);
    return { ...segment, treatment: classification.treatment, reason };
  });
}

function attendanceExceptionTotals(segments) {
  return (segments || []).reduce((total, segment) => {
    if (segment.treatment === 'paid') total.paidMinutes += segment.minutes;
    else total.noWorkNoPayMinutes += segment.minutes;
    return total;
  }, { paidMinutes: 0, noWorkNoPayMinutes: 0 });
}

function dayOffsetMinutes(workDate, date) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(workDate || '')) ? new Date(`${workDate}T12:00:00Z`) : null;
  const target = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? new Date(`${date}T12:00:00Z`) : null;
  if (!base || !target || !Number.isFinite(base.getTime()) || !Number.isFinite(target.getTime())) return undefined;
  return Math.round((target.getTime() - base.getTime()) / 86_400_000) * 1_440;
}

function segmentInterval(workDate, segment) {
  const startOffset = dayOffsetMinutes(workDate, segment?.startDate);
  const endOffset = dayOffsetMinutes(workDate, segment?.endDate);
  const startClock = minutesOfDay(segment?.startTime);
  const endClock = minutesOfDay(segment?.endTime);
  if ([startOffset, endOffset, startClock, endClock].some((value) => value === undefined)) return null;
  const start = startOffset + startClock;
  const end = endOffset + endClock;
  if (end <= start) return null;
  return [start, end];
}

function mergeIntervals(intervals) {
  const sorted = (intervals || [])
    .filter((interval) => Array.isArray(interval) && Number.isFinite(interval[0]) && Number.isFinite(interval[1]) && interval[1] > interval[0])
    .map((interval) => [interval[0], interval[1]])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval[0] > previous[1]) merged.push(interval);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function intervalMinutes(intervals) {
  return mergeIntervals(intervals).reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0);
}

function subtractIntervals(intervals, exclusions) {
  const source = mergeIntervals(intervals);
  const blockers = mergeIntervals(exclusions);
  const result = [];
  for (const [sourceStart, sourceEnd] of source) {
    let fragments = [[sourceStart, sourceEnd]];
    for (const [blockStart, blockEnd] of blockers) {
      const next = [];
      for (const [start, end] of fragments) {
        if (blockEnd <= start || blockStart >= end) {
          next.push([start, end]);
          continue;
        }
        if (blockStart > start) next.push([start, Math.min(blockStart, end)]);
        if (blockEnd < end) next.push([Math.max(blockEnd, start), end]);
      }
      fragments = next;
      if (!fragments.length) break;
    }
    result.push(...fragments);
  }
  return mergeIntervals(result);
}

function outsideScheduleIntervals(intervals, schedule) {
  const scheduleStart = minutesOfDay(schedule?.startTime);
  const scheduleEnd = minutesOfDay(schedule?.endTime);
  if (Number(schedule?.scheduledMinutes) <= 0 || scheduleStart === undefined || scheduleEnd === undefined || scheduleEnd <= scheduleStart) {
    return mergeIntervals(intervals);
  }
  const result = [];
  for (const [start, end] of mergeIntervals(intervals)) {
    if (start < scheduleStart) result.push([start, Math.min(end, scheduleStart)]);
    if (end > scheduleEnd) result.push([Math.max(start, scheduleEnd), end]);
  }
  return mergeIntervals(result);
}

/**
 * Extends the canonical daily attendance calculation with externally evidenced work
 * segments (currently Work Order after-hours completion). Segments never fabricate
 * work in gaps and overlap with the base Clock In/Out interval only once.
 * Missing-scheduled-time classification intentionally remains owned by the base
 * attendance record because after-hours evidence cannot classify in-shift absences.
 */
function calculateAttendanceVarianceWithWorkSegments(input) {
  const base = calculateAttendanceVariance(input || {});
  const workDate = String(input?.workDate || '').trim();
  const segments = (Array.isArray(input?.workSegments) ? input.workSegments : [])
    .map((segment) => segmentInterval(workDate, segment))
    .filter(Boolean);
  if (!workDate || !segments.length) {
    return { ...base, workSegmentMinutes: 0, workSegmentOvertimeMinutes: 0 };
  }

  const actualStart = minutesOfDay(input?.clockInTime);
  const actualEnd = minutesOfDay(input?.clockOutTime);
  const baseIntervals = actualStart !== undefined && actualEnd !== undefined && actualEnd > actualStart
    ? [[actualStart, actualEnd]]
    : [];
  const uniqueSegmentIntervals = subtractIntervals(segments, baseIntervals);
  const workSegmentMinutes = intervalMinutes(uniqueSegmentIntervals);
  const workSegmentOvertimeMinutes = intervalMinutes(outsideScheduleIntervals(uniqueSegmentIntervals, input?.schedule || {}));

  return {
    ...base,
    workedMinutes: base.workedMinutes + workSegmentMinutes,
    overtimeMinutes: base.overtimeMinutes + workSegmentOvertimeMinutes,
    workSegmentMinutes,
    workSegmentOvertimeMinutes,
  };
}

module.exports = {
  attendanceExceptionKindLabel,
  attendanceExceptionTotals,
  calculateAttendanceVariance,
  calculateAttendanceVarianceWithWorkSegments,
  classifyAttendanceExceptions,
  hasValidWorkedTimeRange,
  minutesBetween,
  scheduledBreakMinutes,
  workedMinutes,
};
