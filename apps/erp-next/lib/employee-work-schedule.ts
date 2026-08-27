import {
  canonicalVanId,
  type CanonicalStaffProfile,
  type CanonicalVan,
  type CanonicalVanHalfDaySchedule,
} from './canonical-operations';
import { applyHalfDaySchedule, defaultAttendanceSchedule, type AttendanceSchedule, type EmployeePayrollSettings } from './employee-attendance';

type EmploymentDatedStaffProfile = CanonicalStaffProfile & {
  employmentStartedAt?: string;
  employmentEndedAt?: string;
};

function minutesFromTimes(start?: string, end?: string) {
  if (!start || !end) return undefined;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return undefined;
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
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

export function isTechnicalEmployee(profile: CanonicalStaffProfile) {
  return profile.employeeType === 'Técnico'
    || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '');
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

  const schedule = defaultAttendanceSchedule(date);
  const technical = isTechnicalEmployee(profile);
  const van = employeeVan(profile, vans);
  const vanId = van ? canonicalVanId(van.id, vans) : '';
  const vanHalfDay = halfDaySchedules.find((rule) => vanId && canonicalVanId(rule.vanId, vans) === vanId);

  // Field technicians inherit the recurring half-day from their canonical Van/team.
  // Employee payroll settings never override the operational Van half-day policy.
  if (technical && vanHalfDay?.weekday !== undefined) {
    const ruleMinutes = minutesFromTimes(vanHalfDay.workdayStart ?? schedule.startTime, vanHalfDay.workdayEnd);
    return applyHalfDaySchedule(
      schedule,
      date,
      vanHalfDay.weekday,
      ruleMinutes ? ruleMinutes / 60 : 5,
      3,
      undefined,
      'afternoon',
    );
  }

  // Office/non-technical staff use the existing employeePayrollSettings record as the
  // single employee-specific recurring half-day source. Legacy records without a period
  // keep their historical behavior: work the morning and take the afternoon off.
  if (!technical && payrollSettings?.weeklyHalfDayWeekday != null) {
    return applyHalfDaySchedule(
      schedule,
      date,
      payrollSettings.weeklyHalfDayWeekday,
      payrollSettings.halfDayWorkedHours ?? 4,
      payrollSettings.halfDayPaidFreeHours ?? 4,
      payrollSettings.halfDayEffectiveFrom,
      payrollSettings.halfDayOffPeriod ?? 'afternoon',
    );
  }

  return schedule;
}
