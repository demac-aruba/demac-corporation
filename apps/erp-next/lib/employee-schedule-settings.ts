import type { CanonicalStaffProfile } from './canonical-operations';
import type { EmployeePayrollSettings, HalfDayOffPeriod } from './employee-attendance';
import { isTechnicalEmployee } from './employee-classification';
import { saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';

export type EmployeeScheduleMode = 'company' | 'custom';
export type EmployeeScheduleTemplateId = 'office-8-5' | 'late-9-6' | 'custom';
export type EmployeeScheduleWeekdayKey = '1' | '2' | '3' | '4' | '5' | '6';

export type EmployeeScheduleDay = {
  startTime: string;
  endTime: string;
  breakMinutes: number;
};

export type EmployeeWeeklySchedule = Partial<Record<EmployeeScheduleWeekdayKey, EmployeeScheduleDay>>;

export type EmployeePartialDayWindow = {
  startTime: string;
  endTime: string;
  breakMinutes: number;
  workedMinutes: number;
};

export type EmployeeScheduleVersion = {
  id: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  mode: EmployeeScheduleMode;
  templateId: EmployeeScheduleTemplateId;
  weeklySchedule: EmployeeWeeklySchedule;
  halfDayWeekday?: number | null;
  halfDayOffPeriod: HalfDayOffPeriod;
  halfDayWorkedHours: number;
  halfDayPaidFreeHours: number;
  halfDayUsesExactHours?: boolean;
  halfDayStartTime?: string | null;
  halfDayEndTime?: string | null;
  halfDayBreakMinutes?: number;
  createdAt: string;
  updatedAt: string;
};

export type EmployeePayrollScheduleSettings = EmployeePayrollSettings & {
  scheduleMode?: EmployeeScheduleMode;
  scheduleTemplateId?: EmployeeScheduleTemplateId;
  weeklySchedule?: EmployeeWeeklySchedule;
  scheduleEffectiveFrom?: string | null;
  scheduleEffectiveUntil?: string | null;
  scheduleVersions?: EmployeeScheduleVersion[];
  halfDayUsesExactHours?: boolean;
  halfDayStartTime?: string | null;
  halfDayEndTime?: string | null;
  halfDayBreakMinutes?: number;
};

export const OFFICE_SCHEDULE_TEMPLATES: Array<{
  id: Exclude<EmployeeScheduleTemplateId, 'custom'>;
  label: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
}> = [
  { id: 'office-8-5', label: 'Office Shift', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
  { id: 'late-9-6', label: 'Late Shift', startTime: '09:00', endTime: '18:00', breakMinutes: 60 },
];

export function defaultEmployeeWeeklySchedule(startTime = '08:00', endTime = '17:00', breakMinutes = 60): EmployeeWeeklySchedule {
  return Object.fromEntries(
    (['1', '2', '3', '4', '5', '6'] as EmployeeScheduleWeekdayKey[]).map((weekday) => [weekday, { startTime, endTime, breakMinutes }]),
  ) as EmployeeWeeklySchedule;
}

export function asEmployeePayrollScheduleSettings(settings?: EmployeePayrollSettings): EmployeePayrollScheduleSettings | undefined {
  return settings as EmployeePayrollScheduleSettings | undefined;
}

export function scheduleTemplate(templateId: EmployeeScheduleTemplateId | undefined) {
  return OFFICE_SCHEDULE_TEMPLATES.find((template) => template.id === templateId);
}

export function employeeWeeklyScheduleFromSettings(settings?: EmployeePayrollSettings): EmployeeWeeklySchedule {
  const extended = asEmployeePayrollScheduleSettings(settings);
  const template = scheduleTemplate(extended?.scheduleTemplateId);
  const fallback = defaultEmployeeWeeklySchedule(template?.startTime ?? '08:00', template?.endTime ?? '17:00', template?.breakMinutes ?? 60);
  const stored = extended?.weeklySchedule ?? {};
  return normalizeWeeklySchedule({ ...fallback, ...stored });
}

export function defaultPartialDayWindow(
  day: EmployeeScheduleDay,
  offPeriod: HalfDayOffPeriod = 'afternoon',
  workedMinutes = 240,
): EmployeePartialDayWindow {
  const startMinutes = timeToMinutes(day.startTime);
  const endMinutes = timeToMinutes(day.endTime);
  const requested = Math.max(1, Math.round(Number(workedMinutes) || 240));
  const workStart = offPeriod === 'morning' ? Math.max(startMinutes, endMinutes - requested) : startMinutes;
  const workEnd = offPeriod === 'morning' ? endMinutes : Math.min(endMinutes, startMinutes + requested);
  return normalizePartialDayWindow({
    startTime: minutesToTime(workStart),
    endTime: minutesToTime(workEnd),
    breakMinutes: 0,
  });
}

export function employeePartialDayFromSettings(
  settings: EmployeePayrollSettings | undefined,
  weeklySchedule: EmployeeWeeklySchedule,
  weekday: number | null | undefined,
  offPeriod: HalfDayOffPeriod = 'afternoon',
): EmployeePartialDayWindow {
  const extended = asEmployeePayrollScheduleSettings(settings);
  const normalizedWeekday = weekday != null && weekday >= 1 && weekday <= 6 ? weekday : 1;
  const key = String(normalizedWeekday) as EmployeeScheduleWeekdayKey;
  const companyDay = defaultEmployeeWeeklySchedule()[key]!;
  const baseDay = extended?.scheduleMode === 'custom' ? weeklySchedule[key] ?? companyDay : companyDay;

  if (extended?.halfDayUsesExactHours && extended.halfDayStartTime && extended.halfDayEndTime) {
    return normalizePartialDayWindow({
      startTime: extended.halfDayStartTime,
      endTime: extended.halfDayEndTime,
      breakMinutes: extended.halfDayBreakMinutes ?? 0,
    });
  }

  const legacyWorkedMinutes = Math.max(1, Math.round(Number(settings?.halfDayWorkedHours ?? 4) * 60));
  return defaultPartialDayWindow(baseDay, offPeriod, legacyWorkedMinutes);
}

export function scheduleVersionForDate(settings: EmployeePayrollScheduleSettings | undefined, date: string) {
  const versions = normalizedVersions(settings?.scheduleVersions ?? []);
  const matches = versions.filter((version) => version.effectiveFrom <= date && (!version.effectiveUntil || date <= version.effectiveUntil));
  return matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function buildEmployeeScheduleChanges(input: {
  employee: CanonicalStaffProfile;
  existing?: EmployeePayrollSettings;
  mode: EmployeeScheduleMode;
  templateId: EmployeeScheduleTemplateId;
  weeklySchedule: EmployeeWeeklySchedule;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  halfDayWeekday?: number | null;
  halfDayOffPeriod?: HalfDayOffPeriod;
  halfDayStartTime?: string | null;
  halfDayEndTime?: string | null;
  halfDayBreakMinutes?: number;
  now?: string;
}) {
  if (isTechnicalEmployee(input.employee)) {
    throw new Error('Technical recurring schedules are governed by the employee’s Van/team and cannot be saved as an individual payroll schedule.');
  }
  if (!input.effectiveFrom) throw new Error('Choose when this employee schedule becomes effective.');
  if (input.effectiveUntil && input.effectiveUntil < input.effectiveFrom) {
    throw new Error('The schedule end date cannot be before the effective start date.');
  }
  const weekday = input.halfDayWeekday == null ? null : Math.round(Number(input.halfDayWeekday));
  if (weekday !== null && (weekday < 1 || weekday > 6)) throw new Error('Choose a partial-day weekday from Monday through Saturday.');

  const now = input.now ?? new Date().toISOString();
  const weeklySchedule = normalizeWeeklySchedule(input.weeklySchedule);
  const existingExtended = asEmployeePayrollScheduleSettings(input.existing);
  const offPeriod = input.halfDayOffPeriod ?? 'afternoon';
  const partialDay = weekday === null
    ? null
    : partialDayForInput({
      mode: input.mode,
      weekday,
      weeklySchedule,
      offPeriod,
      startTime: input.halfDayStartTime,
      endTime: input.halfDayEndTime,
      breakMinutes: input.halfDayBreakMinutes,
    });
  const versions = ensureLegacyBaseline(existingExtended, now);
  const priorSameDate = versions.find((version) => version.effectiveFrom === input.effectiveFrom);
  const nextVersion: EmployeeScheduleVersion = {
    id: priorSameDate?.id ?? `schedule-${input.effectiveFrom}`,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil || null,
    mode: input.mode,
    templateId: input.templateId,
    weeklySchedule,
    halfDayWeekday: weekday,
    halfDayOffPeriod: offPeriod,
    halfDayWorkedHours: partialDay ? roundHours(partialDay.workedMinutes) : 0,
    // Legacy field retained for schema compatibility. Recurring partial days count worked time only.
    halfDayPaidFreeHours: 0,
    halfDayUsesExactHours: Boolean(partialDay),
    halfDayStartTime: partialDay?.startTime ?? null,
    halfDayEndTime: partialDay?.endTime ?? null,
    halfDayBreakMinutes: partialDay?.breakMinutes ?? 0,
    createdAt: priorSameDate?.createdAt ?? now,
    updatedAt: now,
  };
  const scheduleVersions = normalizedVersions([
    ...versions.filter((version) => version.effectiveFrom !== input.effectiveFrom),
    nextVersion,
  ]);

  return {
    sourceStaffId: input.employee.id,
    name: input.employee.name,
    role: input.employee.role,
    employeeType: input.employee.employeeType,
    active: input.employee.active !== false,
    weekdayHours: input.existing?.weekdayHours ?? 8,
    saturdayHours: input.existing?.saturdayHours ?? 8,
    scheduleMode: input.mode,
    scheduleTemplateId: input.templateId,
    weeklySchedule,
    scheduleEffectiveFrom: input.effectiveFrom,
    scheduleEffectiveUntil: input.effectiveUntil || null,
    scheduleVersions,
    // Keep the current rule projected into legacy fields so older readers still resolve the weekday.
    weeklyHalfDayWeekday: weekday,
    halfDayEffectiveFrom: input.effectiveFrom,
    halfDayWorkedHours: partialDay ? roundHours(partialDay.workedMinutes) : 0,
    halfDayPaidFreeHours: 0,
    halfDayOffPeriod: offPeriod,
    halfDayUsesExactHours: Boolean(partialDay),
    halfDayStartTime: partialDay?.startTime ?? null,
    halfDayEndTime: partialDay?.endTime ?? null,
    halfDayBreakMinutes: partialDay?.breakMinutes ?? 0,
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  } satisfies Omit<EmployeePayrollScheduleSettings, 'id'>;
}

export async function saveEmployeeScheduleSettings(input: {
  employee: CanonicalStaffProfile;
  existing?: EmployeePayrollSettings;
  mode: EmployeeScheduleMode;
  templateId: EmployeeScheduleTemplateId;
  weeklySchedule: EmployeeWeeklySchedule;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  halfDayWeekday?: number | null;
  halfDayOffPeriod?: HalfDayOffPeriod;
  halfDayStartTime?: string | null;
  halfDayEndTime?: string | null;
  halfDayBreakMinutes?: number;
}) {
  const id = input.existing?.id ?? input.employee.id;
  const changes = buildEmployeeScheduleChanges(input);
  if (input.existing) {
    // Firestore update masks preserve unrelated real payroll fields on existing employee records.
    return updateFirestoreDocument<EmployeePayrollScheduleSettings>('employeePayrollSettings', id, changes as Record<string, unknown>);
  }
  return saveFirestoreDocument<EmployeePayrollScheduleSettings>('employeePayrollSettings', { id, ...changes });
}

function ensureLegacyBaseline(settings: EmployeePayrollScheduleSettings | undefined, now: string): EmployeeScheduleVersion[] {
  const existingVersions = normalizedVersions(settings?.scheduleVersions ?? []);
  if (existingVersions.length || !settings) return existingVersions;
  const hasLegacySchedule = settings.weeklyHalfDayWeekday != null
    || Boolean(settings.halfDayEffectiveFrom)
    || settings.scheduleMode !== undefined
    || settings.weeklySchedule !== undefined;
  if (!hasLegacySchedule) return existingVersions;
  const effectiveFrom = settings.scheduleEffectiveFrom ?? settings.halfDayEffectiveFrom ?? '0001-01-01';
  return [{
    id: `legacy-baseline-${effectiveFrom}`,
    effectiveFrom,
    effectiveUntil: settings.scheduleEffectiveUntil ?? null,
    mode: settings.scheduleMode ?? 'company',
    templateId: settings.scheduleTemplateId ?? 'office-8-5',
    weeklySchedule: employeeWeeklyScheduleFromSettings(settings),
    halfDayWeekday: settings.weeklyHalfDayWeekday ?? null,
    halfDayOffPeriod: settings.halfDayOffPeriod ?? 'afternoon',
    halfDayWorkedHours: settings.halfDayWorkedHours ?? 4,
    halfDayPaidFreeHours: settings.halfDayPaidFreeHours ?? 0,
    halfDayUsesExactHours: settings.halfDayUsesExactHours ?? false,
    halfDayStartTime: settings.halfDayStartTime ?? null,
    halfDayEndTime: settings.halfDayEndTime ?? null,
    halfDayBreakMinutes: settings.halfDayBreakMinutes ?? 0,
    createdAt: settings.createdAt ?? now,
    updatedAt: settings.updatedAt ?? now,
  }];
}

function normalizedVersions(versions: EmployeeScheduleVersion[]) {
  return versions
    .filter((version) => Boolean(version?.effectiveFrom))
    .map((version) => ({
      ...version,
      weeklySchedule: normalizeWeeklySchedule(version.weeklySchedule),
      halfDayOffPeriod: version.halfDayOffPeriod ?? 'afternoon',
      halfDayWorkedHours: Number(version.halfDayWorkedHours ?? 4),
      halfDayPaidFreeHours: Number(version.halfDayPaidFreeHours ?? 0),
      halfDayUsesExactHours: version.halfDayUsesExactHours ?? false,
      halfDayBreakMinutes: Math.max(0, Math.round(Number(version.halfDayBreakMinutes) || 0)),
    }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt));
}

function normalizeWeeklySchedule(schedule: EmployeeWeeklySchedule) {
  const fallback = defaultEmployeeWeeklySchedule();
  return Object.fromEntries(
    (['1', '2', '3', '4', '5', '6'] as EmployeeScheduleWeekdayKey[]).map((weekday) => [weekday, normalizeScheduleDay(schedule[weekday] ?? fallback[weekday]!)]),
  ) as EmployeeWeeklySchedule;
}

function normalizeScheduleDay(day: EmployeeScheduleDay): EmployeeScheduleDay {
  const startTime = normalizeTime(day.startTime, '08:00');
  const endTime = normalizeTime(day.endTime, '17:00');
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const breakMinutes = Math.max(0, Math.min(180, Math.round(Number(day.breakMinutes) || 0)));
  if (endMinutes <= startMinutes) throw new Error(`Schedule end time ${endTime} must be after start time ${startTime}.`);
  if (endMinutes - startMinutes - breakMinutes <= 0) throw new Error('Break duration must be shorter than the employee shift.');
  if (endMinutes - startMinutes - breakMinutes !== 480) {
    throw new Error('DEMAC full office workdays must contain exactly 8 worked hours after the break. Partial-day hours are configured separately and may be shorter.');
  }
  return { startTime, endTime, breakMinutes };
}

function partialDayForInput(input: {
  mode: EmployeeScheduleMode;
  weekday: number;
  weeklySchedule: EmployeeWeeklySchedule;
  offPeriod: HalfDayOffPeriod;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number;
}) {
  const key = String(input.weekday) as EmployeeScheduleWeekdayKey;
  const baseDay = input.mode === 'custom'
    ? input.weeklySchedule[key] ?? defaultEmployeeWeeklySchedule()[key]!
    : defaultEmployeeWeeklySchedule()[key]!;
  const fallback = defaultPartialDayWindow(baseDay, input.offPeriod, 240);
  return normalizePartialDayWindow({
    startTime: input.startTime || fallback.startTime,
    endTime: input.endTime || fallback.endTime,
    breakMinutes: input.breakMinutes ?? fallback.breakMinutes,
  });
}

function normalizePartialDayWindow(day: Omit<EmployeePartialDayWindow, 'workedMinutes'>): EmployeePartialDayWindow {
  const startTime = normalizeTime(day.startTime, '08:00');
  const endTime = normalizeTime(day.endTime, '12:00');
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const breakMinutes = Math.max(0, Math.min(180, Math.round(Number(day.breakMinutes) || 0)));
  if (endMinutes <= startMinutes) throw new Error(`Partial-day end time ${endTime} must be after start time ${startTime}.`);
  const workedMinutes = endMinutes - startMinutes - breakMinutes;
  if (workedMinutes <= 0) throw new Error('Partial-day break duration must be shorter than the worked time window.');
  return { startTime, endTime, breakMinutes, workedMinutes };
}

function normalizeTime(value: string | undefined, fallback: string) {
  const match = String(value ?? '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function roundHours(minutes: number) {
  return Math.round((Math.max(0, minutes) / 60) * 100) / 100;
}
