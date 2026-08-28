import {
  canonicalVanId,
  type CanonicalStaffProfile,
  type CanonicalVan,
  type CanonicalVanHalfDaySchedule,
} from './canonical-operations';
import { applyHalfDaySchedule, defaultAttendanceSchedule, minutesBetween, type AttendanceSchedule, type EmployeePayrollSettings } from './employee-attendance';
import { isTechnicalEmployee } from './employee-classification';
import {
  asEmployeePayrollScheduleSettings,
  defaultEmployeeWeeklySchedule,
  scheduleVersionForDate,
  type EmployeeScheduleVersion,
  type EmployeeScheduleWeekdayKey,
} from './employee-schedule-settings';

export { isTechnicalEmployee } from './employee-classification';

function minutesFromTimes(start?: string, end?: string) {
  if (!start || !end) return undefined;
  const minutes = minutesBetween(start, end);
  return minutes > 0 ? minutes : undefined;
}

function employmentBoundary(profile: CanonicalStaffProfile, date: string): AttendanceSchedule | null {
  const lifecycle = profile as CanonicalStaffProfile & { employmentStartedAt?: string; employmentEndedAt?: string };
  if (lifecycle.employmentStartedAt && date < lifecycle.employmentStartedAt) {
    return { startTime: '', endTime: '', scheduledMinutes: 0, paidFreeMinutes: 0, label: `Not employed yet · starts ${lifecycle.employmentStartedAt}` };
  }
  if (lifecycle.employmentEndedAt && date > lifecycle.employmentEndedAt) {
    return { startTime: '', endTime: '', scheduledMinutes: 0, paidFreeMinutes: 0, label: `Employment ended ${lifecycle.employmentEndedAt}` };
  }
  return null;
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
    halfDayPaidFreeHours: extended.halfDayPaidFreeHours ?? 4,
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
  const lifecycleBoundary = employmentBoundary(profile, date);
  if (lifecycleBoundary) return lifecycleBoundary;

  const companySchedule = defaultAttendanceSchedule(date);
  // Sunday remains the protected company closure regardless of any employee configuration.
  if (!companySchedule.scheduledMinutes) return companySchedule;

  const technical = isTechnicalEmployee(profile);
  const van = employeeVan(profile, vans);
  const vanId = van ? canonicalVanId(van.id, vans) : '';
  const vanHalfDay = halfDaySchedules.find((rule) => vanId && canonicalVanId(rule.vanId, vans) === vanId);

  // Field technicians inherit the recurring half-day from their canonical Van/team.
  // Employee payroll settings never override the operational Van half-day policy or base shift.
  if (technical) {
    if (vanHalfDay?.weekday === undefined) return companySchedule;
    const ruleMinutes = minutesFromTimes(vanHalfDay.workdayStart ?? companySchedule.startTime, vanHalfDay.workdayEnd);
    return applyHalfDaySchedule(
      companySchedule,
      date,
      vanHalfDay.weekday,
      ruleMinutes ? ruleMinutes / 60 : 5,
      3,
      undefined,
      'afternoon',
    );
  }

  const version = officeScheduleVersion(payrollSettings, date);
  const schedule = baseScheduleForVersion(version, date, companySchedule);

  // Office/non-technical staff use one effective, versioned schedule inside the existing
  // employeePayrollSettings authority. Historical versions remain available for recalculation.
  if (version?.halfDayWeekday != null) {
    return applyHalfDaySchedule(
      schedule,
      date,
      version.halfDayWeekday,
      version.halfDayWorkedHours,
      version.halfDayPaidFreeHours,
      version.effectiveFrom,
      version.halfDayOffPeriod,
    );
  }

  return schedule;
}
