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

export type AttendanceWorkSegment = {
  workOrderId: string;
  appointmentId?: string;
  kind?: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startedAt?: string;
  completedAt?: string;
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

export type AttendanceVarianceWithWorkSegments = AttendanceVariance & {
  workSegmentMinutes: number;
  workSegmentOvertimeMinutes: number;
};

export function minutesBetween(startTime: string, endTime: string): number;
export function workedMinutes(clockInTime: string, clockOutTime: string, breakMinutes?: number): number;
export function scheduledBreakMinutes(schedule: AttendanceScheduleForCalculation): number;
export function hasValidWorkedTimeRange(clockInTime: string, clockOutTime: string): boolean;
export function calculateAttendanceVariance(input: {
  schedule: AttendanceScheduleForCalculation;
  clockInTime: string;
  clockOutTime: string;
  breakMinutes: number;
}): AttendanceVariance;
export function calculateAttendanceVarianceWithWorkSegments(input: {
  workDate: string;
  schedule: AttendanceScheduleForCalculation;
  clockInTime: string;
  clockOutTime: string;
  breakMinutes: number;
  workSegments?: AttendanceWorkSegment[];
}): AttendanceVarianceWithWorkSegments;
export function classifyAttendanceExceptions(
  variance: AttendanceVariance,
  classifications: AttendanceExceptionClassification[] | undefined,
): AttendanceExceptionSegment[];
export function attendanceExceptionTotals(segments: AttendanceExceptionSegment[]): { paidMinutes: number; noWorkNoPayMinutes: number };
export function attendanceExceptionKindLabel(kind: AttendanceExceptionKind): string;
