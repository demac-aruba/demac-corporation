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
    breakAppliedToEarlyDepartureMinutes: 0,
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
  const scheduledMinutes = Math.max(0, Number(schedule.scheduledMinutes) || 0);
  const outsideShiftOvertime = Math.min(workedMinutesValue, earlyStartMinutes + lateFinishMinutes);
  const regularWorkedMinutes = Math.max(0, workedMinutesValue - outsideShiftOvertime);
  const overlapsSchedule = actualStart < scheduleEnd && actualEnd > scheduleStart;
  const rawLateArrivalMinutes = actualStart > scheduleStart
    ? Math.max(0, Math.min(actualStart, scheduleEnd) - scheduleStart)
    : 0;
  const rawEarlyDepartureMinutes = actualEnd < scheduleEnd
    ? Math.max(0, scheduleEnd - Math.max(actualEnd, scheduleStart))
    : 0;

  // A partial worked day does not earn an unused lunch allowance. Reconcile
  // actual regular work against scheduled *worked* minutes, not the gross
  // clock span (which includes scheduled non-working lunch). Keep outside-shift
  // overtime independent. This aggregate has no invented absence time range.
  if (overlapsSchedule && regularWorkedMinutes < scheduledMinutes && actualBreakMinutes < expectedBreakMinutes) {
    const missingScheduledMinutes = scheduledMinutes - regularWorkedMinutes;
    const lateArrivalMinutes = Math.min(scheduledMinutes, rawLateArrivalMinutes);
    return {
      ...emptyVariance(expectedBreakMinutes, workedMinutesValue),
      earlyStartMinutes,
      lateFinishMinutes,
      overtimeMinutes: outsideShiftOvertime,
      // Clock deviations remain diagnostic; only missingSegments determines
      // payable/unpaid no-work time for this partial day.
      lateArrivalMinutes,
      earlyDepartureMinutes: Math.min(scheduledMinutes - lateArrivalMinutes, rawEarlyDepartureMinutes),
      missingScheduledMinutes,
      missingSegments: [{ kind: 'partial_day', minutes: missingScheduledMinutes }],
    };
  }

  const unusedBreakMinutes = regularWorkedMinutes >= scheduledMinutes
    ? Math.max(0, expectedBreakMinutes - actualBreakMinutes)
    : 0;
  // Only a completed regular workday may move unused break to its end.
  // Late arrival and work outside the scheduled shift retain their own treatment.
  const breakAppliedToEarlyDepartureMinutes = overlapsSchedule
    ? Math.min(unusedBreakMinutes, rawEarlyDepartureMinutes)
    : 0;
  const rawOvertimeMinutes = earlyStartMinutes + lateFinishMinutes
    + unusedBreakMinutes - breakAppliedToEarlyDepartureMinutes;
  const overtimeMinutes = Math.min(workedMinutesValue, rawOvertimeMinutes);

  const lateArrivalMinutes = Math.min(Number(schedule.scheduledMinutes) || 0, rawLateArrivalMinutes);
  const remainingAfterLateArrival = Math.max(0, (Number(schedule.scheduledMinutes) || 0) - lateArrivalMinutes);

  const earlyDepartureMinutes = Math.min(
    remainingAfterLateArrival,
    rawEarlyDepartureMinutes - breakAppliedToEarlyDepartureMinutes,
  );
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
    const missingEnd = scheduleEnd - breakAppliedToEarlyDepartureMinutes;
    missingSegments.push({
      kind: 'early_departure',
      minutes: earlyDepartureMinutes,
      fromTime: actualEnd <= scheduleStart ? schedule.startTime : clockOutTime,
      toTime: breakAppliedToEarlyDepartureMinutes > 0
        ? `${String(Math.floor(missingEnd / 60)).padStart(2, '0')}:${String(missingEnd % 60).padStart(2, '0')}`
        : schedule.endTime,
    });
  }
  if (extendedBreakMinutes > 0) missingSegments.push({ kind: 'extended_break', minutes: extendedBreakMinutes });

  return {
    expectedBreakMinutes,
    workedMinutes: workedMinutesValue,
    earlyStartMinutes,
    lateFinishMinutes,
    unusedBreakMinutes,
    breakAppliedToEarlyDepartureMinutes,
    overtimeMinutes,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    extendedBreakMinutes,
    missingScheduledMinutes,
    missingSegments,
  };
}

function attendanceExceptionKindLabel(kind) {
  if (kind === 'partial_day') return 'no work';
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
  if (Array.isArray(input?.workIntervals) && input.workIntervals.length) return calculateSplitAttendance(input);
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

// Opt-in attendance intervals. The legacy calculation above is unchanged for every
// existing record without these fields. Off-duty gaps are never worked minutes.
function normalizeAttendanceIntervals(intervals) {
  if (!Array.isArray(intervals) || !intervals.length || intervals.length > 12) throw new Error('Enter between 1 and 12 work intervals.');
  const normalized = intervals.map((row) => {
    const startDayOffset = row.startDayOffset ?? 0;
    const endDayOffset = row.endDayOffset ?? 0;
    const startClock = /^\d{2}:\d{2}$/.test(row.startTime) ? minutesOfDay(row.startTime) : undefined;
    const endClock = /^\d{2}:\d{2}$/.test(row.endTime) ? minutesOfDay(row.endTime) : undefined;
    if (startClock === undefined || endClock === undefined || ![0, 1].includes(startDayOffset) || ![0, 1].includes(endDayOffset)) throw new Error('Choose valid times and dates for every interval.');
    const start = startClock + startDayOffset * 1440, end = endClock + endDayOffset * 1440;
    const pause = row.breakMinutes;
    if (end <= start || end - start > 1440) throw new Error('Clock Out must be later than Clock In, within 24 hours. Select next day when applicable.');
    if (!Number.isInteger(pause) || pause < 0 || pause >= end - start) throw new Error('Break minutes must be a whole number smaller than the work interval.');
    return { startTime: row.startTime, endTime: row.endTime, startDayOffset, endDayOffset, breakMinutes: pause, start, end };
  }).sort((a, b) => a.start - b.start);
  if (normalized[0].startDayOffset !== 0) throw new Error('The first work interval must start on the selected date.');
  for (let i = 1; i < normalized.length; i++) if (normalized[i].start < normalized[i - 1].end) throw new Error('Work intervals cannot overlap.');
  return normalized;
}

function calculateSplitAttendance(input) {
  const rows = normalizeAttendanceIntervals(input.workIntervals);
  const schedule = input.schedule || {};
  const scheduled = Math.max(0, Number(schedule.scheduledMinutes) || 0);
  const scheduleStart = minutesOfDay(schedule.startTime), scheduleEnd = minutesOfDay(schedule.endTime);
  const expectedBreak = scheduledBreakMinutes(schedule);
  let insideWorked = 0, outsideWorked = 0, earlyStart = 0, lateFinish = 0;
  for (const row of rows) {
    const inside = scheduled > 0 && scheduleStart !== undefined && scheduleEnd !== undefined
      ? Math.max(0, Math.min(row.end, scheduleEnd) - Math.max(row.start, scheduleStart)) : 0;
    // A duration-only break consumes regular-window time first, matching the
    // existing daily attendance policy. Outside-only intervals deduct their own break.
    const regularBreak = Math.min(inside, row.breakMinutes);
    insideWorked += inside - regularBreak;
    outsideWorked += row.end - row.start - inside - (row.breakMinutes - regularBreak);
    if (scheduled > 0) {
      earlyStart += Math.max(0, Math.min(row.end, scheduleStart) - row.start);
      lateFinish += Math.max(0, row.end - Math.max(row.start, scheduleEnd));
    }
  }
  const manualIntervals = rows.map((r) => [r.start, r.end]);
  const evidence = (input.workSegments || []).map((segment) => segmentInterval(input.workDate, segment)).filter(Boolean);
  const unique = subtractIntervals(evidence, manualIntervals);
  const evidenceMinutes = intervalMinutes(unique);
  const evidenceOvertime = intervalMinutes(outsideScheduleIntervals(unique, schedule));
  const regularMinutes = Math.min(scheduled, insideWorked);
  const missing = Math.max(0, scheduled - regularMinutes);
  const extraInside = Math.max(0, insideWorked - scheduled);
  const first = rows[0], last = rows[rows.length - 1];
  return {
    ...emptyVariance(expectedBreak, insideWorked + outsideWorked + evidenceMinutes),
    earlyStartMinutes: earlyStart,
    lateFinishMinutes: lateFinish,
    unusedBreakMinutes: extraInside,
    overtimeMinutes: outsideWorked + extraInside + evidenceOvertime,
    lateArrivalMinutes: scheduled > 0 ? Math.max(0, Math.min(scheduled, first.start - scheduleStart)) : 0,
    earlyDepartureMinutes: scheduled > 0 ? Math.max(0, Math.min(scheduled, scheduleEnd - last.end)) : 0,
    missingScheduledMinutes: missing,
    missingSegments: missing ? [{ kind: 'partial_day', minutes: missing }] : [],
    workSegmentMinutes: evidenceMinutes,
    workSegmentOvertimeMinutes: evidenceOvertime,
    excludedGapMinutes: rows.slice(1).reduce((sum, row, i) => sum + row.start - rows[i].end, 0),
  };
}

// Absolute-minute windows for cross-date conflict checks; includes Work Order evidence.
function attendanceWorkWindows(entry, referenceDate) {
  const offset = (Date.parse(entry.date + 'T00:00:00Z') - Date.parse(referenceDate + 'T00:00:00Z')) / 60000;
  if (!Number.isFinite(offset)) throw new Error('Invalid attendance date.');
  const base = entry.workIntervals?.length ? normalizeAttendanceIntervals(entry.workIntervals).map(r => [r.start, r.end])
    : hasValidWorkedTimeRange(entry.clockInTime, entry.clockOutTime) ? [[minutesOfDay(entry.clockInTime), minutesOfDay(entry.clockOutTime)]] : [];
  const evidence = (entry.workOrderAttendanceSegments || []).map(s => segmentInterval(entry.date, s)).filter(Boolean);
  return mergeIntervals([...base, ...evidence]).map(([start, end]) => [start + offset, end + offset]);
}

function validateOvertimePayAllocations(allocations, overtimeMinutes) {
  if (!Array.isArray(allocations) || allocations.length > 24) throw new Error('Choose valid overtime pay allocations.');
  let total = 0;
  const result = allocations.map((row) => {
    if (![150, 200].includes(row.rate) || !Number.isInteger(row.minutes) || row.minutes <= 0) throw new Error('Each overtime allocation needs a positive number of minutes and a 150% or 200% rate.');
    total += row.minutes;
    return { rate: row.rate, minutes: row.minutes };
  });
  if (total !== overtimeMinutes) throw new Error('Assigned overtime must exactly match calculated overtime.');
  return result;
}

function overtimeRateTotals(entry) {
  const total = Math.max(0, Math.round(Number(entry?.overtimeMinutes ?? (Number(entry?.overtimeHours || 0) * 60)) || 0));
  const allocations = entry?.overtimePayAllocations;
  let at150 = 0, at200 = 0, invalid = allocations != null && !Array.isArray(allocations);
  for (const row of Array.isArray(allocations) ? allocations : []) {
    if (!row || ![150, 200].includes(row.rate) || !Number.isInteger(row.minutes) || row.minutes <= 0) { invalid = true; continue; }
    if (row.rate === 150) at150 += row.minutes; else at200 += row.minutes;
  }
  const remainder = Math.max(0, total - at150 - at200);
  const requiresReview = invalid || at150 + at200 > total;
  // Owner policy: regular OT defaults to 150%; only an explicit selection earns 200%.
  // Project historical/new evidence without rewriting records or masking invalid allocations.
  return { at150: at150 + (requiresReview ? 0 : remainder), at200, unassigned: requiresReview ? remainder : 0, requiresReview };
}

module.exports = {
  attendanceExceptionKindLabel,
  attendanceExceptionTotals,
  calculateAttendanceVariance,
  calculateAttendanceVarianceWithWorkSegments,
  normalizeAttendanceIntervals,
  validateOvertimePayAllocations,
  overtimeRateTotals,
  classifyAttendanceExceptions,
  hasValidWorkedTimeRange,
  minutesBetween,
  scheduledBreakMinutes,
  workedMinutes,
};

module.exports.attendanceWorkWindows = attendanceWorkWindows;
