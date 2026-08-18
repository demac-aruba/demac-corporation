import { listFirestoreCollection } from './firebase/firestore-rest';
import { resolveCanonicalVanId, type LiveVan } from './live-scheduling';

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
};

const CAPACITY_CACHE_MS = 15_000;
let capacityCache: { expiresAt: number; promise: Promise<LiveOperationalCapacityState> } | null = null;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedStatus(value: unknown) {
  return text(value).toLowerCase();
}

function recordPreference(van: LiveVan, canonicalId: string) {
  if (text(van.id).toUpperCase() === canonicalId) return 3;
  if (resolveCanonicalVanId(van.id, [van]) === canonicalId) return 2;
  return 1;
}

function canonicalVanCatalog(vans: LiveVan[]) {
  const selected = new Map<string, LiveVan>();
  for (const van of vans) {
    if (!van || van.active === false) continue;
    const canonicalId = resolveCanonicalVanId(van.id, vans) || resolveCanonicalVanId(van.name, vans);
    if (!canonicalId) continue;
    const current = selected.get(canonicalId);
    if (!current || recordPreference(van, canonicalId) > recordPreference(current, canonicalId)) selected.set(canonicalId, van);
  }
  return new Map([...selected.entries()].map(([id, van]) => [id, {
    id,
    active: van.active !== false,
    status: text((van as LiveVan & { status?: string }).status),
  }]));
}

function canonicalVanId(value: unknown, vans: LiveVan[]) {
  return resolveCanonicalVanId(value, vans);
}

export async function loadLiveOperationalCapacityState(): Promise<LiveOperationalCapacityState> {
  const now = Date.now();
  if (capacityCache && capacityCache.expiresAt > now) return capacityCache.promise;

  const promise = Promise.all([
    listFirestoreCollection<LiveVan>('vans', 250),
    listFirestoreCollection<LiveDailyVanAssignment>('dailyVanAssignments', 500),
    listFirestoreCollection<LiveVanHalfDaySchedule>('vanHalfDaySchedules', 250),
  ]).then(([vans, dailyAssignments, halfDaySchedules]) => ({
    vans: canonicalVanCatalog(vans),
    dailyAssignments: dailyAssignments.map((assignment) => ({
      ...assignment,
      vanId: canonicalVanId(assignment.vanId, vans) || assignment.vanId,
    })),
    halfDaySchedules: halfDaySchedules.map((schedule) => ({
      ...schedule,
      vanId: canonicalVanId(schedule.vanId, vans) || schedule.vanId,
    })),
  }));

  capacityCache = { expiresAt: now + CAPACITY_CACHE_MS, promise };
  promise.catch(() => {
    if (capacityCache?.promise === promise) capacityCache = null;
  });
  return promise;
}

function weekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

export function liveVanIsHalfDay(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  if (!state) return false;
  const day = weekday(dateKey);
  return state.halfDaySchedules.some((schedule) => schedule.active !== false
    && schedule.vanId === vanId
    && Number(schedule.weekday) === day);
}

export function liveVanOperationallyAvailable(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  if (!state) return true;
  const van = state.vans.get(vanId);
  if (!van || van.active === false) return false;
  if (['mantenimiento', 'fuera de servicio'].includes(normalizedStatus(van.status))) return false;
  const assignment = state.dailyAssignments.find((item) => item.vanId === vanId && item.date === dateKey);
  return !['mantenimiento', 'fuera de servicio'].includes(normalizedStatus(assignment?.status));
}

export function liveOperationalWindowAllows(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  start: string,
  end: string,
) {
  if (!liveVanOperationallyAvailable(state, vanId, dateKey)) return false;
  if (!liveVanIsHalfDay(state, vanId, dateKey)) return true;
  return start >= '08:30' && end <= '12:30';
}
