import type { OfficeBookingOption } from './office-booking-authority';
import { optionAssignmentCapacityEnd, optionAssignmentStart, optionPrimaryAssignment } from './live-appointment-edit-state';

export function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function laterDate(left: string, right: string) {
  return left >= right ? left : right;
}

export function optionPrimaryVanId(option: OfficeBookingOption) {
  return optionPrimaryAssignment(option)?.vanId || '';
}

export function optionDurationMinutes(option: OfficeBookingOption) {
  const primary = optionPrimaryAssignment(option);
  const explicit = Number(primary?.durationMinutes || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const itemTotal = Array.isArray(option.workItems)
    ? option.workItems.reduce((sum, item) => sum + Math.max(0, Number(item.durationMinutes) || 0), 0)
    : 0;
  if (itemTotal > 0) return itemTotal;
  const start = primary ? optionAssignmentStart(option, primary) : option.time;
  const end = primary ? optionAssignmentCapacityEnd(option, primary) : option.capacityEndTime || option.endTime || '';
  const parse = (value: string) => {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
  };
  const delta = parse(end) - parse(start);
  return Number.isFinite(delta) && delta > 0 ? delta : 0;
}

export function optionsForVan(options: OfficeBookingOption[], dateKey: string, vanId: string) {
  return options
    .filter((option) => option.date === dateKey && optionPrimaryVanId(option) === vanId)
    .sort((left, right) => {
      const a = optionPrimaryAssignment(left);
      const b = optionPrimaryAssignment(right);
      return optionAssignmentStart(left, a || left.assignments[0]).localeCompare(optionAssignmentStart(right, b || right.assignments[0]));
    });
}

export function optionKey(option: OfficeBookingOption) {
  return `${option.id}|${option.date}|${option.time}`;
}
