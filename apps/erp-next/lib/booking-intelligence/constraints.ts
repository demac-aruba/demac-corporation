import type { BookingRestriction, HalfDay } from '../scheduling';

export type BookingConstraintState = {
  requestedDate?: string;
  requestedWeekday?: number;
  halfDay?: HalfDay;
  notBefore?: string;
  notAfter?: string;
  sourceNotes?: string[];
};

export type BookingConstraintPatch = Partial<Omit<BookingConstraintState, 'sourceNotes'>> & {
  clearDate?: boolean;
  clearTimeWindow?: boolean;
  sourceNote?: string;
};

function clean(value?: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value?: string) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function normalizeClock(rawValue?: string) {
  const raw = clean(rawValue);
  const match = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\b/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = String(match[3] ?? '').toLowerCase();
  if (suffix.includes('p') && hour < 12) hour += 12;
  if (suffix.includes('a') && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function weekdayFromText(value: string) {
  const normalized = normalizeText(value);
  const aliases: Array<[number, RegExp]> = [
    [1, /\b(monday|lunes|dialuna)\b/],
    [2, /\b(tuesday|martes|diamars)\b/],
    [3, /\b(wednesday|miercoles|diaranson)\b/],
    [4, /\b(thursday|jueves|diahuebs)\b/],
    [5, /\b(friday|viernes|diabierna)\b/],
    [6, /\b(saturday|sabado|diasabra)\b/],
    [0, /\b(sunday|domingo|diadomingo)\b/],
  ];
  return aliases.find(([, pattern]) => pattern.test(normalized))?.[0];
}

export function inferBookingConstraintPatch(text: string): BookingConstraintPatch {
  const raw = clean(text);
  const normalized = normalizeText(raw);
  const patch: BookingConstraintPatch = { sourceNote: raw || undefined };
  const isoDate = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) patch.requestedDate = isoDate;
  const weekday = weekdayFromText(raw);
  if (weekday !== undefined) patch.requestedWeekday = weekday;

  if (/\b(afternoon|tarde|merdia)\b/.test(normalized)) patch.halfDay = 'pm';
  if (/\b(morning|manana|mainta)\b/.test(normalized)) patch.halfDay = 'am';

  const time = normalizeClock(raw);
  if (time && /\b(after|later than|despues|posterior|luego de|mas tarde de|a partir de|desde|starting at|from)\b/.test(normalized)) patch.notBefore = time;
  if (time && /\b(before|earlier than|antes de|hasta|until)\b/.test(normalized)) patch.notAfter = time;
  return patch;
}

export function mergeBookingConstraints(previous: BookingConstraintState = {}, patch: BookingConstraintPatch = {}): BookingConstraintState {
  const next: BookingConstraintState = {
    ...previous,
    ...(patch.clearDate ? { requestedDate: undefined, requestedWeekday: undefined } : {}),
    ...(patch.clearTimeWindow ? { halfDay: undefined, notBefore: undefined, notAfter: undefined } : {}),
  };
  if (patch.requestedDate !== undefined) next.requestedDate = patch.requestedDate;
  if (patch.requestedWeekday !== undefined) next.requestedWeekday = patch.requestedWeekday;
  if (patch.halfDay !== undefined) next.halfDay = patch.halfDay;
  if (patch.notBefore !== undefined) next.notBefore = patch.notBefore;
  if (patch.notAfter !== undefined) next.notAfter = patch.notAfter;
  if (patch.sourceNote) next.sourceNotes = [...(previous.sourceNotes ?? []), patch.sourceNote].slice(-8);
  return next;
}

export function bookingRestrictionFromConstraints(state?: BookingConstraintState): BookingRestriction | undefined {
  if (!state) return undefined;
  const restriction: BookingRestriction = {};
  if (state.halfDay) restriction.halfDay = state.halfDay;
  if (state.notBefore) restriction.notBefore = state.notBefore;
  if (state.notAfter) restriction.notAfter = state.notAfter;
  return Object.keys(restriction).length ? restriction : undefined;
}

export function describeBookingConstraints(state?: BookingConstraintState) {
  if (!state) return 'No customer restriction';
  const parts: string[] = [];
  if (state.requestedDate) parts.push(state.requestedDate);
  else if (state.requestedWeekday !== undefined) parts.push(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][state.requestedWeekday]);
  if (state.halfDay) parts.push(state.halfDay === 'am' ? 'morning' : 'afternoon');
  if (state.notBefore) parts.push(`after ${state.notBefore}`);
  if (state.notAfter) parts.push(`before ${state.notAfter}`);
  return parts.join(' · ') || 'No customer restriction';
}
