export type AttendanceExceptionKind = 'late_arrival' | 'early_departure' | 'extended_break';
export type AttendancePaymentTreatment = 'paid' | 'no_work_no_pay';

export type AttendanceExceptionClassification = {
  kind: AttendanceExceptionKind;
  treatment?: AttendancePaymentTreatment;
  reason?: string;
};

export type DetectedAttendanceException = {
  kind: AttendanceExceptionKind;
  minutes: number;
  fromTime?: string;
  toTime?: string;
};

export type AttendanceExceptionSegment = DetectedAttendanceException & {
  treatment: AttendancePaymentTreatment;
  reason: string;
};

export type AttendanceScheduleForCalculation = {
  startTime: string;
  endTime: string;
  scheduledMinutes: number;
};

export type AttendanceVariance = {
  expectedBreakMinutes: number;
  workedMinutes: number;
  earlyStartMinutes: number;
  lateFinishMinutes: number;
  unusedBreakMinutes: number;
  overtimeMinutes: number;
  lateArrivalMinutes: number;
  earlyDepartureMinutes: number;
  extendedBreakMinutes: number;
  missingScheduledMinutes: number;
  missingSegments: DetectedAttendanceException[];
};

function minutesOfDay(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  if (![hour, minute].every(Number.isFinite)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return hour * 60 + minute;
}

export function minutesBetween(startTime: string, endTime: string) {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  if (start === undefined || end === undefined) return 0;
  return Math.max(0, end - start);
}

export function workedMinutes(clockInTime: string, clockOutTime: string, breakMinutes = 0) {
  if (!clockInTime || !clockOutTime) return 0;
  return Math.max(0, minutesBetween(clockInTime, clockOutTime) - Math.max(0, Math.round(Number(breakMinutes) || 0)));
}

export function scheduledBreakMinutes(schedule: AttendanceScheduleForCalculation) {
  if (!schedule.startTime || !schedule.endTime || schedule.scheduledMinutes <= 0) return 0;
  return Math.max(0, minutesBetween(schedule.startTime, schedule.endTime) - Math.max(0, schedule.scheduledMinutes));
}

export function hasValidWorkedTimeRange(clockInTime: string, clockOutTime: string) {
  const start = minutesOfDay(clockInTime);
  const end = minutesOfDay(clockOutTime);
  return start !== undefined && end !== undefined && end > start;
}

/**
 * OPS-STAFF-ATTENDANCE-002 / 003.
 * Overtime and missing scheduled time are intentionally calculated independently.
 * Early work, late work and unused scheduled break are overtime; they never erase a
 * late arrival, early departure or extended break that must be classified separately.
 */
export function calculateAttendanceVariance(input: {
  schedule: AttendanceScheduleForCalculation;
  clockInTime: string;
  clockOutTime: string;
  breakMinutes: number;
}): AttendanceVariance {
  const { schedule, clockInTime, clockOutTime } = input;
  const actualBreakMinutes = Math.max(0, Math.round(Number(input.breakMinutes) || 0));
  const expectedBreakMinutes = scheduledBreakMinutes(schedule);
  const workedMinutesValue = workedMinutes(clockInTime, clockOutTime, actualBreakMinutes);

  if (!schedule.startTime || !schedule.endTime || schedule.scheduledMinutes <= 0 || !clockInTime || !clockOutTime) {
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

  const earlyStartMinutes = minutesBetween(clockInTime, schedule.startTime);
  const lateFinishMinutes = minutesBetween(schedule.endTime, clockOutTime);
  const unusedBreakMinutes = Math.max(0, expectedBreakMinutes - actualBreakMinutes);
  const lateArrivalMinutes = minutesBetween(schedule.startTime, clockInTime);
  const earlyDepartureMinutes = minutesBetween(clockOutTime, schedule.endTime);
  const extendedBreakMinutes = Math.max(0, actualBreakMinutes - expectedBreakMinutes);

  const missingSegments: DetectedAttendanceException[] = [];
  if (lateArrivalMinutes > 0) {
    missingSegments.push({
      kind: 'late_arrival',
      minutes: lateArrivalMinutes,
      fromTime: schedule.startTime,
      toTime: clockInTime,
    });
  }
  if (earlyDepartureMinutes > 0) {
    missingSegments.push({
      kind: 'early_departure',
      minutes: earlyDepartureMinutes,
      fromTime: clockOutTime,
      toTime: schedule.endTime,
    });
  }
  if (extendedBreakMinutes > 0) {
    missingSegments.push({ kind: 'extended_break', minutes: extendedBreakMinutes });
  }

  return {
    expectedBreakMinutes,
    workedMinutes: workedMinutesValue,
    earlyStartMinutes,
    lateFinishMinutes,
    unusedBreakMinutes,
    overtimeMinutes: earlyStartMinutes + lateFinishMinutes + unusedBreakMinutes,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    extendedBreakMinutes,
    missingScheduledMinutes: lateArrivalMinutes + earlyDepartureMinutes + extendedBreakMinutes,
    missingSegments,
  };
}

export function classifyAttendanceExceptions(
  variance: AttendanceVariance,
  classifications: AttendanceExceptionClassification[] | undefined,
) {
  const byKind = new Map((classifications ?? []).map((classification) => [classification.kind, classification]));
  return variance.missingSegments.map((segment): AttendanceExceptionSegment => {
    const classification = byKind.get(segment.kind);
    if (!classification?.treatment) {
      throw new Error(`Choose Paid or No Work No Pay for ${attendanceExceptionKindLabel(segment.kind)}.`);
    }
    const reason = classification.reason?.trim() ?? '';
    if (!reason) {
      throw new Error(`Enter a reason for ${attendanceExceptionKindLabel(segment.kind)}.`);
    }
    return {
      ...segment,
      treatment: classification.treatment,
      reason,
    };
  });
}

export function attendanceExceptionTotals(segments: AttendanceExceptionSegment[]) {
  return segments.reduce((total, segment) => {
    if (segment.treatment === 'paid') total.paidMinutes += segment.minutes;
    else total.noWorkNoPayMinutes += segment.minutes;
    return total;
  }, { paidMinutes: 0, noWorkNoPayMinutes: 0 });
}

export function attendanceExceptionKindLabel(kind: AttendanceExceptionKind) {
  if (kind === 'late_arrival') return 'late arrival';
  if (kind === 'early_departure') return 'early departure';
  return 'extended break';
}
