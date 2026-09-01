import { canonicalVanId } from './canonical-operations';
import {
  getFirestoreDocument,
  listFirestoreCollection,
  queryFirestoreCollectionDateRange,
  queryFirestoreCollectionOverlappingDateRange,
  type FirestoreOverlapDateRangeArgs,
} from './firebase/firestore-rest';

export type LiveDailyVanAssignment = {
  id: string;
  date?: string;
  vanId?: string;
  driverStaffId?: string;
  helperStaffId?: string;
  additionalHelperStaffId?: string;
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

export type LiveStaffProfile = {
  id: string;
  name?: string;
  active?: boolean;
  availability?: string;
  unavailableFrom?: string;
  unavailableUntil?: string;
  canDriveVan?: boolean;
};

export type LiveStaffAbsence = {
  id: string;
  active?: boolean;
  staffId?: string;
  fromDate?: string;
  toDate?: string;
};

export type LiveOperationalVan = {
  id: string;
  name?: string;
  active: boolean;
  status: string;
  responsibleStaffId?: string;
  regularHelperId?: string;
  additionalHelperId?: string;
};

export type LiveOperationalCapacityState = {
  vans: Map<string, LiveOperationalVan>;
  staffProfiles: LiveStaffProfile[];
  staffAbsences?: LiveStaffAbsence[];
  dailyAssignments: LiveDailyVanAssignment[];
  halfDaySchedules: LiveVanHalfDaySchedule[];
  calendarClosures: LiveCalendarClosure[];
  closedWeekdays: number[];
};

export type LiveVanCrew = {
  driverStaffId?: string;
  helperStaffId?: string;
  additionalHelperStaffId?: string;
  driverName?: string;
  helperName?: string;
  additionalHelperName?: string;
  technicianIds: string[];
  label: string;
};

export type CapacityLoadArgs = {
  startDate?: string;
  endDate?: string;
  force?: boolean;
};

export type LiveOperationalVanRecord = {
  id: string;
  name?: string;
  active?: boolean;
  status?: string;
  responsibleStaffId?: string;
  regularHelperId?: string;
  additionalHelperId?: string;
};

const CACHE_TTL_MS = 60_000;

function weekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function timeMinutes(value: string) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function blockedOperationalStatus(value: string | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'mantenimiento' || normalized === 'fuera de servicio' || normalized === 'sin personal';
}

function liveStaffUnavailable(profile: LiveStaffProfile | undefined, dateKey: string, absences: LiveStaffAbsence[]) {
  if (!profile || profile.active === false || text(profile.availability).toLowerCase() === 'inactivo') return true;
  const availability = text(profile.availability);
  const generallyUnavailable = Boolean(availability && availability !== 'Disponible')
    && (!profile.unavailableFrom || dateKey >= profile.unavailableFrom)
    && (!profile.unavailableUntil || dateKey <= profile.unavailableUntil);
  return generallyUnavailable || absences.some((absence) => absence.active !== false
    && absence.staffId === profile.id
    && Boolean(absence.fromDate)
    && Boolean(absence.toDate)
    && dateKey >= String(absence.fromDate)
    && dateKey <= String(absence.toDate));
}

function normalizeClosedWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [0];
  return [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
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

export type LiveStaffAbsenceReaders = {
  queryOverlap?: (args: FirestoreOverlapDateRangeArgs) => Promise<LiveStaffAbsence[]>;
  listAll?: () => Promise<LiveStaffAbsence[]>;
};

export async function loadLiveStaffAbsencesForRange(
  startDate?: string,
  endDate?: string,
  readers: LiveStaffAbsenceReaders = {},
) {
  if (startDate && endDate) {
    const queryOverlap = readers.queryOverlap
      ?? ((args: FirestoreOverlapDateRangeArgs) => queryFirestoreCollectionOverlappingDateRange<LiveStaffAbsence>(args));
    return queryOverlap({
      collectionId: 'staffAbsences',
      startFieldPath: 'fromDate',
      endFieldPath: 'toDate',
      startInclusive: startDate,
      endInclusive: endDate,
    });
  }
  const listAll = readers.listAll ?? (() => listFirestoreCollection<LiveStaffAbsence>('staffAbsences', 1000));
  return listAll();
}

async function loadCapacityState(startDate?: string, endDate?: string): Promise<LiveOperationalCapacityState> {
  const [rawVans, staffProfiles, staffAbsences, rawDailyAssignments, rawHalfDays, rawClosures, businessCalendar] = await Promise.all([
    listFirestoreCollection<LiveOperationalVanRecord>('vans', 250),
    listFirestoreCollection<LiveStaffProfile>('staffProfiles', 500),
    loadLiveStaffAbsencesForRange(startDate, endDate),
    readDateScopedCollection<LiveDailyVanAssignment>('dailyVanAssignments', startDate, endDate, 1000),
    listFirestoreCollection<LiveVanHalfDaySchedule>('vanHalfDaySchedules', 250),
    readDateScopedCollection<LiveCalendarClosure>('calendarClosures', startDate, endDate, 500),
    getFirestoreDocument<LiveBusinessCalendar>('businessSettings', 'business-calendar'),
  ]);

  const canonicalVans = buildLiveOperationalVanRegistry(rawVans);

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
    staffProfiles,
    staffAbsences: staffAbsences.filter((absence) => absence.active !== false),
    dailyAssignments,
    halfDaySchedules,
    calendarClosures: rawClosures.filter((closure) => closure.active !== false),
    closedWeekdays: normalizeClosedWeekdays(businessCalendar?.closedWeekdays),
  };
}

export function buildLiveOperationalVanRegistry(rawVans: LiveOperationalVanRecord[]) {
  const canonicalVans = new Map<string, LiveOperationalVan>();
  for (const van of rawVans) {
    const id = canonicalVanId(van.id, rawVans);
    if (!id) continue;
    const current = canonicalVans.get(id);
    if (!current || van.id === id) {
      canonicalVans.set(id, {
        id,
        name: text(van.name) || id,
        active: van.active !== false,
        status: String(van.status ?? ''),
        responsibleStaffId: text(van.responsibleStaffId) || undefined,
        regularHelperId: text(van.regularHelperId) || undefined,
        additionalHelperId: text(van.additionalHelperId) || undefined,
      });
    }
  }
  return canonicalVans;
}

/**
 * Scheduling needs canonical fleet/calendar policy for display and final drag-target
 * parity with Booking Authority. This reader is deliberately date-scoped and cached:
 * appointments can refresh every 15 seconds without re-reading operational policy on
 * every poll, while a week change or a minute-old cache naturally refreshes the rules.
 * Staff display names ride the same cached read so the live agenda does not add a second
 * workforce-fetch path just to render the assigned Van crew.
 */
export function createLiveOperationalCapacityLoader(
  readState: (startDate?: string, endDate?: string) => Promise<LiveOperationalCapacityState>,
  now: () => number = Date.now,
) {
  const cachedStates = new Map<string, { loadedAt: number; value: LiveOperationalCapacityState }>();
  const pendingLoads = new Map<string, { identity: object; promise: Promise<LiveOperationalCapacityState> }>();

  return function loadCapacity(args: CapacityLoadArgs = {}): Promise<LiveOperationalCapacityState> {
    const key = capacityKey(args.startDate, args.endDate);
    // An in-flight read is already the freshest possible value. Force callers for
    // the same range join it instead of starting a duplicate network read.
    const pending = pendingLoads.get(key);
    if (pending) return pending.promise;
    const requestedAt = now();
    for (const [cachedKey, candidate] of cachedStates) {
      if (requestedAt - candidate.loadedAt >= CACHE_TTL_MS) cachedStates.delete(cachedKey);
    }
    const cached = cachedStates.get(key);
    if (!args.force && cached && requestedAt - cached.loadedAt < CACHE_TTL_MS) {
      return Promise.resolve(cached.value);
    }

    const identity = {};
    const promise = Promise.resolve()
      .then(() => readState(args.startDate, args.endDate))
      .then((value) => {
        // Only the promise still registered for this range may publish its cache.
        if (pendingLoads.get(key)?.identity === identity) cachedStates.set(key, { loadedAt: now(), value });
        return value;
      })
      .finally(() => {
        if (pendingLoads.get(key)?.identity === identity) pendingLoads.delete(key);
      });
    pendingLoads.set(key, { identity, promise });
    return promise;
  };
}

const defaultCapacityLoader = createLiveOperationalCapacityLoader(loadCapacityState);

export function loadLiveOperationalCapacityState(args: CapacityLoadArgs = {}) {
  return defaultCapacityLoader(args);
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

export function liveVanCrew(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string): LiveVanCrew {
  if (!state) return { technicianIds: [], label: 'Crew loading…' };
  const van = state.vans.get(vanId);
  const daily = state.dailyAssignments.find((assignment) => assignment.date === dateKey && assignment.vanId === vanId);
  const driverStaffId = text(daily?.driverStaffId) || text(van?.responsibleStaffId) || undefined;
  const helperStaffId = text(daily?.helperStaffId) || text(van?.regularHelperId) || undefined;
  const additionalHelperStaffId = text(daily?.additionalHelperStaffId) || text(van?.additionalHelperId) || undefined;
  const driverName = driverStaffId ? text(state.staffProfiles.find((profile) => profile.id === driverStaffId)?.name) || undefined : undefined;
  const helperName = helperStaffId ? text(state.staffProfiles.find((profile) => profile.id === helperStaffId)?.name) || undefined : undefined;
  const additionalHelperName = additionalHelperStaffId ? text(state.staffProfiles.find((profile) => profile.id === additionalHelperStaffId)?.name) || undefined : undefined;
  const technicianIds = [driverStaffId, helperStaffId, additionalHelperStaffId].filter((value): value is string => Boolean(value));
  const label = [driverName, helperName, additionalHelperName].filter(Boolean).join(' · ') || 'Crew unassigned';
  return {
    driverStaffId,
    helperStaffId,
    additionalHelperStaffId,
    driverName,
    helperName,
    additionalHelperName,
    technicianIds,
    label,
  };
}

export function liveVanOperationallyAvailable(state: LiveOperationalCapacityState | null, vanId: string, dateKey: string) {
  // A missing registry/operational snapshot is UNKNOWN, never proof that a Van is
  // bookable. Authority remains final and the visual layer fails closed.
  if (!state) return false;
  const van = state.vans.get(vanId);
  if (!van || !van.active || blockedOperationalStatus(van.status)) return false;
  const daily = state.dailyAssignments.find((assignment) => assignment.date === dateKey && assignment.vanId === vanId);
  if (blockedOperationalStatus(daily?.status)) return false;
  const driverStaffId = text(daily?.driverStaffId) || text(van.responsibleStaffId);
  const driver = state.staffProfiles.find((profile) => profile.id === driverStaffId);
  return Boolean(driver?.canDriveVan) && !liveStaffUnavailable(driver, dateKey, state.staffAbsences ?? []);
}

export function liveOperationalWindowAllows(
  state: LiveOperationalCapacityState | null,
  vanId: string,
  dateKey: string,
  start: string,
  end: string,
) {
  if (!state) return false;
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
