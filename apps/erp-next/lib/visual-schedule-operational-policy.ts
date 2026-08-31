import {
  liveVanHalfDaySchedule,
  liveVanOperationallyAvailable,
  type LiveOperationalCapacityState,
} from './live-operational-capacity';
import { timeToMinutes } from './scheduling';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function visualVanDayStatus(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  const operational = liveVanOperationallyAvailable(state, vanId, dateKey);
  const halfDay = liveVanHalfDaySchedule(state, vanId, dateKey);
  if (!operational) return { operational: false, halfDay, label: 'UNAVAILABLE' };
  if (halfDay) {
    const end = text(halfDay.workdayEnd) || '13:00';
    return { operational: true, halfDay, label: `HALF-DAY TO ${formatCompactTime(end)}` };
  }
  return { operational: true, halfDay, label: 'ACTIVE' };
}

export function visualVanSlotAvailableByPolicy(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  slotStart: string,
) {
  if (!liveVanOperationallyAvailable(state, vanId, dateKey)) return false;
  const halfDay = liveVanHalfDaySchedule(state, vanId, dateKey);
  if (!halfDay) return true;

  const start = text(halfDay.workdayStart);
  const end = text(halfDay.workdayEnd);
  const slot = timeToMinutes(slotStart);
  if (!Number.isFinite(slot)) return false;
  if (start && slot < timeToMinutes(start)) return false;
  if (end && slot >= timeToMinutes(end)) return false;
  return true;
}

export function visualOptionFitsVanPolicy(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  optionStart: string,
  optionEnd: string,
) {
  if (!liveVanOperationallyAvailable(state, vanId, dateKey)) return false;
  const halfDay = liveVanHalfDaySchedule(state, vanId, dateKey);
  if (!halfDay) return true;

  const start = text(halfDay.workdayStart);
  const end = text(halfDay.workdayEnd);
  const optionStartMinutes = timeToMinutes(optionStart);
  const optionEndMinutes = timeToMinutes(optionEnd);
  if (!Number.isFinite(optionStartMinutes) || !Number.isFinite(optionEndMinutes)) return false;
  if (start && optionStartMinutes < timeToMinutes(start)) return false;
  if (end && optionEndMinutes > timeToMinutes(end)) return false;
  return true;
}

function formatCompactTime(value: string) {
  const [hourText, minute = '00'] = value.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}
