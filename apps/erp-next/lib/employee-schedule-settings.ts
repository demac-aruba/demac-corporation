import type { CanonicalStaffProfile } from './canonical-operations';
import type { EmployeePayrollSettings, HalfDayOffPeriod } from './employee-attendance';
import { saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';

export type EmployeeScheduleMode = 'company-default' | 'custom';
export type EmployeeHalfDayRule = 'office-4-4' | 'technician-5-3';

export type EmployeeSchedulePayrollSettings = EmployeePayrollSettings & {
  scheduleMode?: EmployeeScheduleMode;
  workdayStart?: string;
  workdayEnd?: string;
  breakMinutes?: number;
  scheduleEffectiveFrom?: string | null;
  halfDayRule?: EmployeeHalfDayRule;
};

export type EmployeeScheduleConfig = {
  mode: EmployeeScheduleMode;
  workdayStart: string;
  workdayEnd: string;
  breakMinutes: number;
  halfDayWeekday: number | null;
  halfDayOffPeriod: HalfDayOffPeriod;
  halfDayRule: EmployeeHalfDayRule;
  halfDayWorkedHours: number;
  halfDayPaidFreeHours: number;
  effectiveFrom: string | null;
};

export const COMPANY_SCHEDULE = {
  workdayStart: '08:00',
  workdayEnd: '17:00',
  breakMinutes: 60,
} as const;

export const EMPLOYEE_SHIFT_TEMPLATES = {
  office: { label: 'Office Shift', workdayStart: '08:00', workdayEnd: '17:00', breakMinutes: 60 },
  late: { label: 'Late Shift', workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60 },
} as const;

export function halfDayRuleHours(rule: EmployeeHalfDayRule) {
  return rule === 'technician-5-3'
    ? { workedHours: 5, paidFreeHours: 3 }
    : { workedHours: 4, paidFreeHours: 4 };
}

export function employeeScheduleConfig(
  settings: EmployeePayrollSettings | undefined,
  technical: boolean,
): EmployeeScheduleConfig {
  const persisted = settings as EmployeeSchedulePayrollSettings | undefined;
  const explicitMode = persisted?.scheduleMode;
  const hasLegacyOfficeHalfDay = !technical
    && explicitMode === undefined
    && persisted?.weeklyHalfDayWeekday != null;
  const mode: EmployeeScheduleMode = explicitMode === 'custom' || hasLegacyOfficeHalfDay
    ? 'custom'
    : 'company-default';
  const halfDayRule: EmployeeHalfDayRule = persisted?.halfDayRule === 'office-4-4'
    || persisted?.halfDayRule === 'technician-5-3'
    ? persisted.halfDayRule
    : technical ? 'technician-5-3' : 'office-4-4';
  const ruleHours = halfDayRuleHours(halfDayRule);
  const weekday = Number(persisted?.weeklyHalfDayWeekday);

  return {
    mode,
    workdayStart: validTime(persisted?.workdayStart) ? persisted!.workdayStart! : COMPANY_SCHEDULE.workdayStart,
    workdayEnd: validTime(persisted?.workdayEnd) ? persisted!.workdayEnd! : COMPANY_SCHEDULE.workdayEnd,
    breakMinutes: validBreakMinutes(persisted?.breakMinutes) ? Math.round(Number(persisted!.breakMinutes)) : COMPANY_SCHEDULE.breakMinutes,
    halfDayWeekday: Number.isInteger(weekday) && weekday >= 1 && weekday <= 6 ? weekday : null,
    halfDayOffPeriod: persisted?.halfDayOffPeriod === 'morning' ? 'morning' : 'afternoon',
    halfDayRule,
    halfDayWorkedHours: ruleHours.workedHours,
    halfDayPaidFreeHours: ruleHours.paidFreeHours,
    effectiveFrom: persisted?.scheduleEffectiveFrom ?? persisted?.halfDayEffectiveFrom ?? null,
  };
}

export async function saveEmployeeScheduleSettings(input: {
  employee: CanonicalStaffProfile;
  existing?: EmployeePayrollSettings;
  mode: EmployeeScheduleMode;
  workdayStart: string;
  workdayEnd: string;
  breakMinutes: number;
  halfDayWeekday: number | null;
  halfDayOffPeriod: HalfDayOffPeriod;
  halfDayRule: EmployeeHalfDayRule;
  effectiveFrom: string;
}) {
  if (input.mode !== 'company-default' && input.mode !== 'custom') {
    throw new Error('Choose a valid employee schedule mode.');
  }
  if (!validTime(input.workdayStart) || !validTime(input.workdayEnd)) {
    throw new Error('Choose valid start and end times.');
  }
  const grossMinutes = timeMinutes(input.workdayEnd) - timeMinutes(input.workdayStart);
  const breakMinutes = Math.round(Number(input.breakMinutes));
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes >= grossMinutes) {
    throw new Error('Break duration must fit inside the employee shift.');
  }
  const paidDayMinutes = grossMinutes - breakMinutes;
  if (input.mode === 'custom' && paidDayMinutes !== 8 * 60) {
    throw new Error('DEMAC custom shifts must equal 8 paid work hours after the break.');
  }
  const weekday = input.halfDayWeekday == null ? null : Math.round(Number(input.halfDayWeekday));
  if (input.mode === 'custom' && (weekday == null || weekday < 1 || weekday > 6)) {
    throw new Error('Choose the recurring partial-day weekday from Monday through Saturday.');
  }
  if (input.mode === 'custom' && !input.effectiveFrom) {
    throw new Error('Choose when the custom schedule becomes effective.');
  }
  if (input.halfDayRule !== 'office-4-4' && input.halfDayRule !== 'technician-5-3') {
    throw new Error('Choose a valid partial-day rule.');
  }

  const now = new Date().toISOString();
  const id = input.existing?.id ?? input.employee.id;
  const halfDay = halfDayRuleHours(input.halfDayRule);
  const current = input.existing as EmployeeSchedulePayrollSettings | undefined;
  const changes: Omit<EmployeeSchedulePayrollSettings, 'id'> = {
    sourceStaffId: input.employee.id,
    name: input.employee.name,
    role: input.employee.role,
    employeeType: input.employee.employeeType,
    active: input.employee.active !== false,
    weekdayHours: paidDayMinutes / 60,
    saturdayHours: paidDayMinutes / 60,
    scheduleMode: input.mode,
    workdayStart: input.workdayStart,
    workdayEnd: input.workdayEnd,
    breakMinutes,
    scheduleEffectiveFrom: input.effectiveFrom || null,
    weeklyHalfDayWeekday: weekday,
    halfDayEffectiveFrom: input.effectiveFrom || null,
    halfDayWorkedHours: halfDay.workedHours,
    halfDayPaidFreeHours: halfDay.paidFreeHours,
    halfDayOffPeriod: input.halfDayOffPeriod,
    halfDayRule: input.halfDayRule,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  if (input.existing) {
    return updateFirestoreDocument<EmployeeSchedulePayrollSettings>(
      'employeePayrollSettings',
      id,
      changes as Record<string, unknown>,
    );
  }
  return saveFirestoreDocument<EmployeeSchedulePayrollSettings>('employeePayrollSettings', { id, ...changes });
}

export function customScheduleActive(config: EmployeeScheduleConfig, date: string) {
  return config.mode === 'custom' && (!config.effectiveFrom || date >= config.effectiveFrom);
}

function validBreakMinutes(value: unknown) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0;
}

function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
