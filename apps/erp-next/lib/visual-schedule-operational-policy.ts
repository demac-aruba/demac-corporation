import {
  liveVanHalfDaySchedule,
  liveVanOperationallyAvailable,
  type LiveOperationalCapacityState,
} from './live-operational-capacity';
import {
  halfDayAllowsSlot,
  halfDayStatusLabel,
  optionFitsHalfDay,
} from './visual-schedule-halfday-policy';

export function visualVanDayStatus(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  const operational = liveVanOperationallyAvailable(state, vanId, dateKey);
  const halfDay = liveVanHalfDaySchedule(state, vanId, dateKey);
  if (!operational) return { operational: false, halfDay, label: 'UNAVAILABLE' };
  return { operational: true, halfDay, label: halfDay ? halfDayStatusLabel(halfDay) : 'ACTIVE' };
}

export function visualVanSlotAvailableByPolicy(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  slotStart: string,
) {
  if (!liveVanOperationallyAvailable(state, vanId, dateKey)) return false;
  return halfDayAllowsSlot(liveVanHalfDaySchedule(state, vanId, dateKey), slotStart);
}

export function visualOptionFitsVanPolicy(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  optionStart: string,
  optionEnd: string,
) {
  if (!liveVanOperationallyAvailable(state, vanId, dateKey)) return false;
  return optionFitsHalfDay(liveVanHalfDaySchedule(state, vanId, dateKey), optionStart, optionEnd);
}
