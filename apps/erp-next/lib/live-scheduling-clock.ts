import { timeToMinutes } from './scheduling';

export type LiveSchedulingClockSnapshot = {
  dateKey: string;
  time: string;
  minuteOfDay: number;
};

const arubaClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Aruba',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function liveSchedulingClockSnapshot(now: Date): LiveSchedulingClockSnapshot {
  const parts = arubaClock.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const dateKey = `${value('year')}-${value('month')}-${value('day')}`;
  const time = `${value('hour')}:${value('minute')}`;
  return { dateKey, time, minuteOfDay: timeToMinutes(time) };
}

export function liveSlotStartHasPassed(
  dateKey: string,
  start: string,
  clock: LiveSchedulingClockSnapshot,
) {
  if (dateKey < clock.dateKey) return true;
  if (dateKey > clock.dateKey) return false;
  return timeToMinutes(start) <= clock.minuteOfDay;
}

export function millisecondsUntilNextClockMinute(now: Date) {
  return Math.max(1, 60_000 - (now.getTime() % 60_000));
}
