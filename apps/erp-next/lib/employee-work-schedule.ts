import { canonicalVanId, type CanonicalStaffProfile, type CanonicalVan, type CanonicalVanHalfDaySchedule } from './canonical-operations';
import { applyHalfDaySchedule, defaultAttendanceSchedule, type AttendanceSchedule, type EmployeePayrollSettings } from './employee-attendance';

function minutesFromTimes(start?: string, end?: string) {
  if (!start || !end) return undefined;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return undefined;
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

export function isTechnicalEmployee(profile: CanonicalStaffProfile) {
  return profile.employeeType === 'Técnico'
    || ['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role ?? '');
}

export function employeeVan(profile: CanonicalStaffProfile, vans: CanonicalVan[]) {
  return vans.find((van) => van.responsibleStaffId === profile.id || van.regularHelperId === profile.id) ?? null;
}

export function resolveEmployeeSchedule(input: {
  profile: CanonicalStaffProfile;
  date: string;
  payrollSettings?: EmployeePayrollSettings;
  vans: CanonicalVan[];
  halfDaySchedules: CanonicalVanHalfDaySchedule[];
}): AttendanceSchedule {
  const { profile, date, payrollSettings, vans, halfDaySchedules } = input;
  let schedule = defaultAttendanceSchedule(date);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  if (weekday !== 0 && payrollSettings) {
    const configuredHours = weekday === 6 ? payrollSettings.saturdayHours : payrollSettings.weekdayHours;
    if (Number(configuredHours) >= 0) {
      const scheduledMinutes = Math.round(Number(configuredHours) * 60);
      schedule = {
        ...schedule,
        scheduledMinutes,
        endTime: schedule.startTime && scheduledMinutes > 0
          ? addMinutes(schedule.startTime, scheduledMinutes + (weekday >= 1 && weekday <= 5 && scheduledMinutes >= 480 ? 60 : 0))
          : schedule.endTime,
        label: `${weekday === 6 ? 'Saturday' : 'Weekday'} · configured ${formatHours(scheduledMinutes)}`,
      };
    }
  }

  const van = employeeVan(profile, vans);
  const vanId = van ? canonicalVanId(van.id, vans) : '';
  const vanHalfDay = halfDaySchedules.find((rule) => vanId && canonicalVanId(rule.vanId, vans) === vanId);

  if (isTechnicalEmployee(profile) && vanHalfDay?.weekday !== undefined) {
    const ruleMinutes = minutesFromTimes(vanHalfDay.workdayStart ?? schedule.startTime, vanHalfDay.workdayEnd);
    return applyHalfDaySchedule(
      schedule,
      date,
      vanHalfDay.weekday,
      ruleMinutes ? ruleMinutes / 60 : payrollSettings?.halfDayWorkedHours ?? 5,
      payrollSettings?.halfDayPaidFreeHours ?? 3,
    );
  }

  if (payrollSettings?.weeklyHalfDayWeekday !== undefined) {
    return applyHalfDaySchedule(
      schedule,
      date,
      payrollSettings.weeklyHalfDayWeekday,
      payrollSettings.halfDayWorkedHours,
      payrollSettings.halfDayPaidFreeHours,
      payrollSettings.halfDayEffectiveFrom,
    );
  }

  return schedule;
}

function addMinutes(startTime: string, minutes: number) {
  const [hour, minute] = startTime.split(':').map(Number);
  const total = (hour * 60 + minute + Math.max(0, minutes)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatHours(minutes: number) {
  const value = Math.max(0, minutes);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
