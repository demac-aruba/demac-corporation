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

/**
 * Manual office drag is intentionally governed by one rule only: the complete
 * appointment block must fit in an open visible schedule window without overlapping
 * another active appointment. Van maintenance, half-day, route, staffing and booking
 * recommendation metadata are not drag restrictions.
 *
 * Keep this compatibility shape while older Scheduling UI code still asks for a
 * capacity state. Returning it synchronously avoids three unnecessary Firestore reads
 * on every agenda refresh and prevents hidden operational metadata from changing drag
 * destinations behind the operator's back.
 */
export async function loadLiveOperationalCapacityState(): Promise<LiveOperationalCapacityState> {
  return {
    vans: new Map(),
    dailyAssignments: [],
    halfDaySchedules: [],
  };
}

export function liveVanIsHalfDay(_state: LiveOperationalCapacityState | null, _vanId: string, _dateKey: string) {
  return false;
}

export function liveVanOperationallyAvailable(_state: LiveOperationalCapacityState | null, _vanId: string, _dateKey: string) {
  return true;
}

export function liveOperationalWindowAllows(
  _state: LiveOperationalCapacityState | null,
  _vanId: string,
  _dateKey: string,
  _start: string,
  _end: string,
) {
  return true;
}
