export type VisualHalfDayWindow = {
  workdayStart?: string;
  workdayEnd?: string;
};

function minutes(value: string | undefined) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function halfDayAllowsSlot(window: VisualHalfDayWindow | undefined, slotStart: string) {
  if (!window) return true;
  const slot = minutes(slotStart);
  if (!Number.isFinite(slot)) return false;
  const start = minutes(window.workdayStart);
  const end = minutes(window.workdayEnd);
  if (Number.isFinite(start) && slot < start) return false;
  if (Number.isFinite(end) && slot >= end) return false;
  return true;
}

export function optionFitsHalfDay(window: VisualHalfDayWindow | undefined, optionStart: string, optionEnd: string) {
  if (!window) return true;
  const start = minutes(optionStart);
  const end = minutes(optionEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  const windowStart = minutes(window.workdayStart);
  const windowEnd = minutes(window.workdayEnd);
  if (Number.isFinite(windowStart) && start < windowStart) return false;
  if (Number.isFinite(windowEnd) && end > windowEnd) return false;
  return true;
}

export function halfDayStatusLabel(window: VisualHalfDayWindow | undefined) {
  if (!window?.workdayEnd) return 'ACTIVE';
  const [hourText, minute = '00'] = window.workdayEnd.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return 'HALF-DAY';
  return `HALF-DAY TO ${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}
