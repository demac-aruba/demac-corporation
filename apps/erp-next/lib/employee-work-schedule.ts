import {
  canonicalVanId,
  type CanonicalStaffProfile,
  type CanonicalVan,
  type CanonicalVanHalfDaySchedule,
} from './canonical-operations';
import { applyHalfDaySchedule, defaultAttendanceSchedule, type AttendanceSchedule, type EmployeePayrollSettings } from './employee-attendance';
import { customScheduleActive, employeeScheduleConfig, type EmployeeScheduleConfig } from './employee-schedule-settings';

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

function customBaseSchedule(config: EmployeeScheduleConfig): AttendanceSchedule {
  const grossMinutes = minutesFromTimes(config.workdayStart, config.workdayEnd) ?? 0;
  const scheduledMinutes = Math.max(0, grossMinutes - config.breakMinutes);
  return {
    startTime: config.workdayStart,
    endTime: config.workdayEnd,
    scheduledMinutes,
    paidFreeMinutes: 0,
    label: `Custom employee shift · ${config.workdayStart}–${config.workdayEnd} · ${config.breakMinutes} min break`,
  };
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

  const companySchedule = defaultAttendanceSchedule(date);
  // Sunday is a company-wide closure and cannot be overridden by an employee or Van schedule.
  if (!companySchedule.scheduledMinutes) return companySchedule;

  const technical = isTechnicalEmployee(profile);
  const employeeConfig = employeeScheduleConfig(payrollSettings, technical);

  // An explicit employee custom schedule is the highest schedule authority after the
  // employment lifecycle and company Sunday closure. This gives both office and field
  // employees the same controlled profile-level scheduling capability.
  if (customScheduleActive(employeeConfig, date)) {
    const base = customBaseSchedule(employeeConfig);
    return applyHalfDaySchedule(
      base,
      date,
      employeeConfig.halfDayWeekday,
      employeeConfig.halfDayWorkedHours,
      employeeConfig.halfDayPaidFreeHours,
      employeeConfig.effectiveFrom,
      employeeConfig.halfDayOffPeriod,
    );
  }

  const van = employeeVan(profile, vans);
  const vanId = van ? canonicalVanId(van.id, vans) : '';
  const vanHalfDay = halfDaySchedules.find((rule) => vanId && canonicalVanId(rule.vanId, vans) === vanId);

  // Technicians without an explicit employee override keep inheriting the recurring
  // partial day from their canonical Van/team. This remains the operational fallback.
  if (technical && vanHalfDay?.weekday !== undefined) {
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

  return companySchedule;
}
