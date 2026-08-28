import {
  canonicalVanId,
  type CanonicalStaffProfile,
  type CanonicalVan,
  type CanonicalVanHalfDaySchedule,
} from './canonical-operations';
import {
  defaultAttendanceSchedule,
  minutesBetween,
  type AttendanceSchedule,
  type EmployeePayrollSettings,
} from './employee-attendance';
import { isTechnicalEmployee } from './employee-classification';
import {
  asEmployeePayrollScheduleSettings,
  defaultEmployeeWeeklySchedule,
  scheduleVersionForDate,
  type EmployeeScheduleVersion,
  type EmployeeScheduleWeekdayKey,
} from './employee-schedule-settings';

export { isTechnicalEmployee } from './employee-classification';

type EmploymentDatedStaffProfile = CanonicalStaffProfile & {
  employmentStartedAt?: string;
  employmentEndedAt?: string;
};

function minutesFromTimes(start?: string, end?: string) {
  if (!start || !end) return undefined;
  const minutes = minutesBetween(start, end);
  return minutes > 0 ? minutes : undefined;
}

export function isEmployeeEmployedOnDate(profile: CanonicalStaffProfile, date: string) {
  const lifecycle = profile as EmploymentDatedStaffProfile;
  if (lifecycle.employmentStartedAt && date < lifecycle.employmentStartedAt) return false;
  if (lifecycle.employmentEndedAt && date > lifecycle.employmentEndedAt) return false;
  return true;
}

function outsideEmploymentSchedule(profile: CanonicalStaffProfile, date: string): AttendanceSchedule {
  const lifecycle = profile as EmploymentDatedStaffProfile;
  const label = lifecycle.employmentStartedAt && date < lifecycle.employmentStartedAt
    ? `Employment starts ${lifecycle.employmentStartedAt}`
    : lifecycle.employmentEndedAt && date > lifecycle.employmentEndedAt
      ? `Employment ended ${lifecycle.employmentEndedAt}`
      : 'Outside employment period';
  return { startTime: '', endTime: '', scheduledMinutes: 0, paidFreeMinutes: 0, label };
}

function officeScheduleVersion(settings: EmployeePayrollSettings | undefined, date: string): EmployeeScheduleVersion | null {
  const extended = asEmployeePayrollScheduleSettings(settings);
  if (!extended) return null;
  if (extended.scheduleVersions?.length) return scheduleVersionForDate(extended, date) ?? null;

  // Backward-compatible projection for records created before schedule versioning.
  const effectiveFrom = extended.scheduleEffectiveFrom ?? extended.halfDayEffectiveFrom ?? '0001-01-01';
  const effectiveUntil = extended.scheduleEffectiveUntil ?? null;
  if (date < effectiveFrom || (effectiveUntil && date > effectiveUntil)) return null;
  const hasV2Schedule = extended.scheduleMode !== undefined || extended.weeklySchedule !== undefined;
  const hasLegacyHalfDay = extended.weeklyHalfDayWeekday != null;
  if (!hasV2Schedule && !hasLegacyHalfDay) return null;

  return {
    id: 'legacy-runtime',
    effectiveFrom,
    effectiveUntil,
    mode: extended.scheduleMode ?? 'company',
    templateId: extended.scheduleTemplateId ?? 'office-8-5',
    weeklySchedule: extended.weeklySchedule ?? defaultEmployeeWeeklySchedule(),
    halfDayWeekday: extended.weeklyHalfDayWeekday ?? null,
    halfDayOffPeriod: extended.halfDayOffPeriod ?? 'afternoon',
    halfDayWorkedHours: extended.halfDayWorkedHours ?? 4,
    halfDayPaidFreeHours: extended.halfDayPaidFreeHours ?? 0,
    halfDayUsesExactHours: extended.halfDayUsesExactHours ?? false,
    halfDayStartTime: extended.halfDayStartTime ?? null,
    halfDayEndTime: extended.halfDayEndTime ?? null,
    halfDayBreakMinutes: extended.halfDayBreakMinutes ?? 0,
    createdAt: extended.createdAt ?? '',
    updatedAt: extended.updatedAt ?? '',
  };
}

function baseScheduleForVersion(version: EmployeeScheduleVersion | null, date: string, fallback: AttendanceSchedule) {
  if (!version || version.mode !== 'custom') return fallback;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday < 1 || weekday > 6) return fallback;
  const key = String(weekday) as EmployeeScheduleWeekdayKey;
  const day = version.weeklySchedule[key] ?? defaultEmployeeWeeklySchedule()[key];
  if (!day) return fallback;

  const spanMinutes = minutesBetween(day.startTime, day.endTime);
  const scheduledMinutes = Math.max(0, spanMinutes - Math.max(0, day.breakMinutes));
  return {
    startTime: day.startTime,
    endTime: day.endTime,
    scheduledMinutes,
    paidFreeMinutes: 0,
    label: `Custom employee schedule · ${day.startTime}–${day.endTime} · ${day.breakMinutes}m break`,
  } satisfies AttendanceSchedule;
}

function exactPartialDaySchedule(version: EmployeeScheduleVersion, fallback: AttendanceSchedule): AttendanceSchedule | null {
  if (!version.halfDayUsesExactHours || !version.halfDayStartTime || !version.halfDayEndTime) return null;
  const spanMinutes = minutesBetween(version.halfDayStartTime, version.halfDayEndTime);
  if (!spanMinutes) return null;
  const breakMinutes = Math.max(0, Math.round(Number(version.halfDayBreakMinutes) || 0));
  const scheduledMinutes = Math.max(0, spanMinutes - breakMinutes);
  if (!scheduledMinutes) return null;
  return {
    ...fallback,
    startTime: version.halfDayStartTime,
    endTime: version.halfDayEndTime,
    scheduledMinutes,
    paidFreeMinutes: 0,
    label: `Weekly partial day · ${version.halfDayStartTime}–${version.halfDayEndTime} · ${workedHoursLabel(scheduledMinutes)} worked`,
  };
}

function derivedPartialDaySchedule(version: EmployeeScheduleVersion, fallback: AttendanceSchedule): AttendanceSchedule | null {
  const workedMinutes = Math.max(0, Math.round(Number(version.halfDayWorkedHours ?? 0) * 60));
  if (!workedMinutes) return null;
  const normalStart = fallback.startTime || '08:00';
  const normalEnd = fallback.endTime || '17:00';
  const startMinutes = timeToMinutes(normalStart);
  const endMinutes = timeToMinutes(normalEnd);
  const workStart = version.halfDayOffPeriod === 'morning' ? Math.max(startMinutes, endMinutes - workedMinutes) : startMinutes;
  const workEnd = version.halfDayOffPeriod === 'morning' ? endMinutes : Math.min(endMinutes, startMinutes + workedMinutes);
  const startTime = minutesToTime(workStart);
  const endTime = minutesToTime(workEnd);
  return {
    ...fallback,
    startTime,
    endTime,
    scheduledMinutes: Math.max(0, workEnd - workStart),
    paidFreeMinutes: 0,
    label: `Weekly partial day · ${startTime}–${endTime} · ${workedHoursLabel(Math.max(0, workEnd - workStart))} worked`,
  };
}

function workedHoursLabel(minutes: number) {
  const hours = Math.round((Math.max(0, minutes) / 60) * 100) / 100;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}h`;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function addMinutes(time: string, minutes: number) {
  return minutesToTime(timeToMinutes(time) + minutes);
}

export function employeeVan(profile: CanonicalStaffProfile, vans: CanonicalVan[]) {
  return vans.find((van) => van.responsibleStaffId === profile.id
    || van.regularHelperId === profile.id
    || van.technicianIds?.includes(profile.id)) ?? null;
}

export function resolveEmployeeSchedule(input: {
  profile: CanonicalStaffProfile;
  date: string;
  payrollSettings?: EmployeePayrollSettings;
  vans: CanonicalVan[];
  halfDaySchedules: CanonicalVanHalfDaySchedule[];
}): AttendanceSchedule {
  const { profile, date, payrollSettings, vans, halfDaySchedules } = input;
  if (!isEmployeeEmployedOnDate(profile, date)) return outsideEmploymentSchedule(profile, date);

  const companySchedule = defaultAttendanceSchedule(date);
  // Sunday is a protected company closure and cannot be overridden by an employee schedule.
  if (!companySchedule.scheduledMinutes) return companySchedule;

  const technical = isTechnicalEmployee(profile);
  const van = employeeVan(profile, vans);
  const vanId = van ? canonicalVanId(van.id, vans) : '';
  const vanHalfDay = halfDaySchedules.find((rule) => vanId && canonicalVanId(rule.vanId, vans) === vanId);

  // Field technicians inherit their recurring partial day from the canonical Van/team only.
  // Only actual worked time is scheduled; there is no synthetic paid-free block.
  if (technical) {
    const dateWeekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (vanHalfDay?.weekday === undefined || vanHalfDay.weekday !== dateWeekday) return companySchedule;
    const startTime = vanHalfDay.workdayStart ?? companySchedule.startTime;
    const endTime = vanHalfDay.workdayEnd ?? addMinutes(startTime, 300);
    const scheduledMinutes = minutesFromTimes(startTime, endTime) ?? 300;
    return {
      ...companySchedule,
      startTime,
      endTime,
      scheduledMinutes,
      paidFreeMinutes: 0,
      label: `Van/team partial day · ${startTime}–${endTime} · ${workedHoursLabel(scheduledMinutes)} worked`,
    };
  }

  const version = officeScheduleVersion(payrollSettings, date);
  const schedule = baseScheduleForVersion(version, date, companySchedule);

  // Office/non-technical staff use the exact partial-day times saved for that employee.
  // Older records without exact times still derive their historical worked window, but paid-free
  // metadata is not counted as scheduled work.
  if (version?.halfDayWeekday != null) {
    const dateWeekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (version.halfDayWeekday === dateWeekday) {
      return exactPartialDaySchedule(version, schedule)
        ?? derivedPartialDaySchedule(version, schedule)
        ?? schedule;
    }
  }

  return schedule;
}
