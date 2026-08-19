import { canonicalVanId } from './canonical-operations';
import {
  getFirestoreDocument,
  listFirestoreCollection,
  queryFirestoreCollectionDateRange,
} from './firebase/firestore-rest';

export type LiveDailyVanAssignment = {
  id: string;
  date?: string;
  vanId?: string;
  status?: string;
};

export type LiveVanHalfDaySchedule = {
  id: string;
  active?: boolean;
  vanId?: string;
  weekday?: number | string;
  workdayStart?: string;
  workdayEnd?: string;
  extraMorningSlot?: string;
};

export type LiveCalendarClosure = {
  id: string;
  active?: boolean;
  date?: string;
  reason?: string;
};

export type LiveBusinessCalendar = {
  id: string;
  closedWeekdays?: number[];
};

export type LiveOperationalVan = {
  id: string;
  active: boolean;
  status: string;
};

export type LiveOperationalCapacityState = {
  vans: Map<string, LiveOperationalVan>;
  dailyAssignments: LiveDailyVanAssignment[];
  halfDaySchedules: LiveVanHalfDaySchedule[];
  calendarClosures: LiveCalendarClosure[];
  closedWeekdays: number[];
};

type CapacityLoadArgs = {
  startDate?: string;
  endDate?: string;
  force?: boolean;
};

type RawVan = {
  id: string;
  name?: string;
  active?: boolean;
  status?: string;
};

const CACHE_TTL_MS = 60_000;
let cachedState: { key: string; loadedAt: number; value: LiveOperationalCapacityState } | null = null;
let pendingLoad: { key: string; promise: Promise<LiveOperationalCapacityState> } | null = null;

function weekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function timeMinutes(value: string) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function blockedOperationalStatus(value: string | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'mantenimiento' || normalized === 'fuera de servicio';
}

function normalizeClosedWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [0];
  const result = [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return result.length ? result : [0];
}

function capacityKey(startDate?: string, endDate?: string) {
  return `${startDate || '*'}|${endDate || '*'}`;
}

async function readDateScopedCollection<T extends { id: string; date?: string }>(collectionId: string, startDate?: string, endDate?: string, limit = 1000) {
  if (startDate && endDate) {
    return queryFirestoreCollectionDateRange<T>({
      collectionId,
      fieldPath: 'date',
      startInclusive: startDate,
      endInclusive: endDate,
      limit,
    });
  }
  return listFirestoreCollection<T>(collectionId, limit);
}

async function loadCapacityState(startDate?: string, endDate?: string): Promise<LiveOperationalCapacityState> {
  const [rawVans, rawDailyAssignments, rawHalfDays, rawClosures, businessCalendar] = await Promise.all([
    listFirestoreCollection<RawVan>('vans', 250),
    readDateScopedCollection<LiveDailyVanAssignment>('dailyVanAssignments', startDate, endDate, 1000),
    listFirestoreCollection<LiveVanHalfDaySchedule>('vanHalfDaySchedules', 250),
    readDateScopedCollection<LiveCalendarClosure>('calendarClosures', startDate, endDate, 500),
    getFirestoreDocument<LiveBusinessCalendar>('businessSettings', 'business-calendar'),
  ]);

  const canonicalVans = new Map<string, LiveOperationalVan>();
  for (const van of rawVans) {
    if (van.active === false) continue;
    const id = canonicalVanId(van.id, rawVans);
    if (!/^VAN-[1-4]$/.test(id)) continue;
    const current = canonicalVans.get(id);
    if (!current || van.id === id) {
      canonicalVans.set(id, {
        id,
        active: van.active !== false,
        status: String(van.status ?? ''),
      });
    }
  }

  const dailyAssignments = rawDailyAssignments.map((assignment) => ({
    ...assignment,
    vanId: canonicalVanId(assignment.vanId, rawVans),
  }));
  const halfDaySchedules = rawHalfDays
    .filter((schedule) => schedule.active !== false)
    .map((schedule) => ({
      ...schedule,
      vanId: canonicalVanId(schedule.vanId, rawVans),
    }));

  return {
    vans: canonicalVans,
    dailyAssignments,
    halfDaySchedules,
    calendarClosures: rawClosures.filter((closure) => closure.active !== false),
    closedWeekdays: normalizeClosedWeekdays(businessCalendar?.closedWeekdays),
  };
}

/**
 * Scheduling needs canonical fleet/calendar policy for display and final drag-target
 * parity with Booking Authority. This reader is deliberately date-scoped and cached:
 * appointments can refresh every 15 seconds without re-reading operational policy on
 * every poll, while a week change or a minute-old cache naturally refreshes the rules.
 */
export async function loadLiveOperationalCapacityState(args: CapacityLoadArgs = {}): Promise<LiveOperationalCapacityState> {
  const key = capacityKey(args.startDate, args.endDate);
  const now = Date.now();
  if (!args.force && cachedState?.key === key && now - cachedState.loadedAt < CACHE_TTL_MS) return cachedState.value;
  if (!args.force && pendingLoad?.key === key) return pendingLoad.promise;

  const promise = loadCapacityState(args.startDate, args.endDate)
    .then((value) => {
      cachedState = { key, loadedAt: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (pendingLoad?.key === key) pendingLoad = null;
    });
  pendingLoad = { key, promise };
  return promise;
}

export function liveCompanyClosureReason(state: LiveOperationalCapacityState | null, dateKey: string) {
  if (!state) return '';
  const special = state.calendarClosures.find((closure) => closure.active !== false && closure.date === dateKey);
  if (special) return String(special.reason || 'Company closed');
  return state.closedWeekdays.includes(weekday(dateKey)) ? 'Company closed' : '';
}

export function liveVanHalfDaySchedule(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  if (!state) return undefined;
  const day = weekday(dateKey);
  return state.halfDaySchedules.find((schedule) => schedule.active !== false
    && schedule.vanId === vanId
    && Number(schedule.weekday) === day);
}

export function liveVanIsHalfDay(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  return Boolean(liveVanHalfDaySchedule(state, vanId, dateKey));
}

export function liveVanOperationallyAvailable(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  if (!state) return true;
  const van = state.vans.get(vanId);
  if (van && (!van.active || blockedOperationalStatus(van.status))) return false;
  const daily = state.dailyAssignments.find((assignment) => assignment.date === dateKey && assignment.vanId === vanId);
  return !blockedOperationalStatus(daily?.status);
}

export function liveOperationalWindowAllows(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  start: string,
  end: string,
) {
  if (!state) return true;
  if (liveCompanyClosureReason(state, dateKey)) return false;
  const halfDay = liveVanHalfDaySchedule(state, vanId, dateKey);
  if (!halfDay) return true;
  const startMinutes = timeMinutes(start);
  const endMinutes = timeMinutes(end);
  const windowStart = timeMinutes(halfDay.workdayStart || '08:00');
  const windowEnd = timeMinutes(halfDay.workdayEnd || '13:00');
  return Number.isFinite(startMinutes)
    && Number.isFinite(endMinutes)
    && startMinutes >= windowStart
    && endMinutes <= windowEnd;
}

export function liveOperationalStartTimes(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  baseStarts: string[],
) {
  const starts = new Set(baseStarts);
  const halfDay = liveVanHalfDaySchedule(state, vanId, dateKey);
  if (halfDay?.extraMorningSlot) starts.add(halfDay.extraMorningSlot);
  return [...starts].sort((left, right) => timeMinutes(left) - timeMinutes(right));
}
