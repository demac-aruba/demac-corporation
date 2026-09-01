const ARUBA_TIME_ZONE = 'America/Aruba';

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value ?? '';
}

export function arubaBookingClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARUBA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = part(parts, 'hour');
  const minute = part(parts, 'minute');
  return {
    dateKey: `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`,
    time: `${hour}:${minute}`,
  };
}

export function isBackdatedAppointmentTarget(dateKey: string, time: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const current = arubaBookingClock(now);
  if (dateKey < current.dateKey) return true;
  if (dateKey > current.dateKey) return false;
  return time <= current.time;
}
