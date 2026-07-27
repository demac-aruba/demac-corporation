import { EmployeeTimesheetEntry } from './types';

const LEGACY_MINUTES_THRESHOLD_HOURS = 12;

export function normalizeOvertimeMinutes(value: string | number | undefined) {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

export function overtimeMinutesToHours(minutes: string | number | undefined) {
  return normalizeOvertimeMinutes(minutes) / 60;
}

export function overtimeHoursToMinutes(hours: string | number | undefined) {
  const parsed = typeof hours === 'string' ? Number(hours.replace(',', '.')) : Number(hours ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 60));
}

export function overtimeMinutesFromEntry(entry?: Pick<EmployeeTimesheetEntry, 'overtimeMinutes' | 'overtimeHours'>) {
  if (!entry) return 0;
  if (entry.overtimeMinutes !== undefined) return normalizeOvertimeMinutes(entry.overtimeMinutes);

  const legacyHours = Math.max(0, Number(entry.overtimeHours ?? 0));
  // Earlier versions accepted a value labelled only as “Overtime”. Operators entered
  // whole minutes, so unrealistic daily values such as 45, 90 or 100 were stored as hours.
  // Preserve legitimate decimal-hour records, but safely interpret impossible daily totals
  // above 12 as legacy minute input until the record is saved again.
  if (Number.isInteger(legacyHours) && legacyHours > LEGACY_MINUTES_THRESHOLD_HOURS) {
    return normalizeOvertimeMinutes(legacyHours);
  }
  return overtimeHoursToMinutes(legacyHours);
}

export function formatOvertimeMinutes(minutes: string | number | undefined) {
  const totalMinutes = normalizeOvertimeMinutes(minutes);
  const wholeHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (!wholeHours) return `${remainingMinutes} min`;
  if (!remainingMinutes) return `${wholeHours} h`;
  return `${wholeHours} h ${remainingMinutes} min`;
}

export function formatOvertimeHours(hours: string | number | undefined) {
  return formatOvertimeMinutes(overtimeHoursToMinutes(hours));
}
