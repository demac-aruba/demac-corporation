export const ARUBA_TIME_ZONE = 'America/Aruba';

function parts(date: Date, includeTime = false) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ARUBA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function arubaDateKey(date = new Date()) {
  const value = parts(date);
  return `${value.year}-${value.month}-${value.day}`;
}

export function arubaTimeKey(date = new Date()) {
  const value = parts(date, true);
  return `${value.hour}:${value.minute}`;
}

export function addDaysToDateKey(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date key: ${dateKey}`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function formatArubaDateKey(dateKey: string, options: Intl.DateTimeFormatOptions = {}) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat('es-AW', {
    timeZone: ARUBA_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(date);
}