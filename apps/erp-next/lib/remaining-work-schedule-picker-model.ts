import type { OfficeBookingOption } from './office-booking-authority';
import {
  optionAssignmentCapacityEnd,
  optionAssignmentStart,
  optionPrimaryAssignment,
  optionSupportWindows,
} from './live-appointment-edit-state';

export type ManualRescheduleSelection = {
  primaryVanId: string;
  optionId: string;
};

export type ManualReschedulePrimaryChoice = {
  vanId: string;
  vanName: string;
  quantity: number;
  slots: number;
  durationMinutes: number;
  optionCount: number;
};

export type ManualRescheduleSupportVan = {
  vanId: string;
  vanName: string;
  start: string;
  workEnd: string;
  capacityEnd: string;
  quantity: number;
  slots: number;
  durationMinutes: number;
};

export type ManualRescheduleSupportChoice = {
  optionId: string;
  primaryVanId: string;
  primaryVanName: string;
  primaryStart: string;
  primaryCapacityEnd: string;
  primaryQuantity: number;
  primarySlots: number;
  primaryDurationMinutes: number;
  supportVans: ManualRescheduleSupportVan[];
};

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

export function emptyManualRescheduleSelection(): ManualRescheduleSelection {
  return { primaryVanId: '', optionId: '' };
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

function vanOrder(value: string) {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function manualReschedulePrimaryChoices(
  options: OfficeBookingOption[],
  dateKey: string,
): ManualReschedulePrimaryChoice[] {
  const choices = new Map<string, ManualReschedulePrimaryChoice>();
  for (const option of options) {
    if (option.date !== dateKey) continue;
    const primary = optionPrimaryAssignment(option);
    if (!primary?.vanId) continue;
    const current = choices.get(primary.vanId);
    choices.set(primary.vanId, {
      vanId: primary.vanId,
      vanName: primary.vanName || current?.vanName || primary.vanId,
      quantity: current?.quantity ?? primary.quantity,
      slots: current?.slots ?? primary.slots,
      durationMinutes: current?.durationMinutes ?? Number(primary.durationMinutes || 0),
      optionCount: (current?.optionCount || 0) + 1,
    });
  }
  return [...choices.values()].sort((left, right) => (
    vanOrder(left.vanId) - vanOrder(right.vanId)
    || left.vanId.localeCompare(right.vanId)
  ));
}

export function manualRescheduleSupportChoices(
  options: OfficeBookingOption[],
  dateKey: string,
  primaryVanId: string,
): ManualRescheduleSupportChoice[] {
  if (!dateKey || !primaryVanId) return [];
  return optionsForVan(options, dateKey, primaryVanId).map((option) => {
    const primary = optionPrimaryAssignment(option);
    const primaryStart = primary ? optionAssignmentStart(option, primary) : option.time;
    const primaryCapacityEnd = primary
      ? optionAssignmentCapacityEnd(option, primary)
      : option.capacityEndTime || option.endTime || '';
    const supportVans = optionSupportWindows(option).map((window) => ({
      vanId: window.assignment.vanId,
      vanName: window.assignment.vanName || window.assignment.vanId,
      start: window.start,
      workEnd: window.workEnd,
      capacityEnd: window.capacityEnd,
      quantity: window.assignment.quantity,
      slots: window.assignment.slots,
      durationMinutes: Number(window.assignment.durationMinutes || 0),
    })).sort((left, right) => (
      left.start.localeCompare(right.start)
      || vanOrder(left.vanId) - vanOrder(right.vanId)
      || left.vanId.localeCompare(right.vanId)
    ));
    return {
      optionId: option.id,
      primaryVanId,
      primaryVanName: primary?.vanName || primaryVanId,
      primaryStart,
      primaryCapacityEnd,
      primaryQuantity: primary?.quantity ?? 0,
      primarySlots: primary?.slots ?? 0,
      primaryDurationMinutes: Number(primary?.durationMinutes || 0),
      supportVans,
    };
  }).sort((left, right) => (
    left.primaryStart.localeCompare(right.primaryStart)
    || left.supportVans.map((support) => `${support.start}|${support.vanId}`).join(',')
      .localeCompare(right.supportVans.map((support) => `${support.start}|${support.vanId}`).join(','))
    || left.optionId.localeCompare(right.optionId)
  ));
}

export function manualRescheduleCandidateOption(
  options: OfficeBookingOption[],
  dateKey: string,
  primaryVanId: string,
  optionId: string,
) {
  if (!dateKey || !primaryVanId || !optionId) return null;
  return options.find((option) => (
    option.id === optionId
    && option.date === dateKey
    && optionPrimaryVanId(option) === primaryVanId
  )) ?? null;
}

export function optionKey(option: OfficeBookingOption) {
  return `${option.id}|${option.date}|${option.time}`;
}
