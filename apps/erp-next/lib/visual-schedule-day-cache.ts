import type { BrowserAppointmentRecord } from './browser-operational';
import { loadLiveSchedulingAppointmentsFast } from './live-scheduling-fast';
import {
  loadLiveOperationalCapacityState,
  type LiveOperationalCapacityState,
} from './live-operational-capacity';
import { addDays } from './remaining-work-schedule-picker-model';

export type VisualScheduleDayContext = {
  dateKey: string;
  appointments: BrowserAppointmentRecord[];
  capacityState: LiveOperationalCapacityState | null;
  loadedAt: number;
};

const CACHE_TTL_MS = 60_000;
const dayCache = new Map<string, VisualScheduleDayContext>();
const windowLoads = new Map<string, Promise<void>>();

function fresh(value: VisualScheduleDayContext | undefined) {
  return Boolean(value && Date.now() - value.loadedAt < CACHE_TTL_MS);
}

export function peekVisualScheduleDay(dateKey: string) {
  const value = dayCache.get(dateKey);
  return fresh(value) ? value ?? null : null;
}

async function loadWindow(centerDate: string) {
  const existing = windowLoads.get(centerDate);
  if (existing) return existing;

  const startDate = addDays(centerDate, -1);
  const endDate = addDays(centerDate, 1);
  // Work Orders and operational fleet state form one projection snapshot. Treating
  // a failed Work Order read as an empty successful list can label every slot OPEN,
  // while treating a failed fleet read as null can silently erase policy. Cache only
  // complete snapshots; callers already render an explicit loading/error state.
  const promise = Promise.all([
    loadLiveSchedulingAppointmentsFast({ startDate, endDate }),
    loadLiveOperationalCapacityState({ startDate, endDate }),
  ]).then(([appointments, capacityState]) => {
    const loadedAt = Date.now();

    for (const dateKey of [startDate, centerDate, endDate]) {
      dayCache.set(dateKey, {
        dateKey,
        appointments: appointments.filter((appointment) => appointment.dateKey === dateKey),
        capacityState,
        loadedAt,
      });
    }

  }).finally(() => {
    if (windowLoads.get(centerDate) === promise) windowLoads.delete(centerDate);
  });

  windowLoads.set(centerDate, promise);
  return promise;
}

export async function loadVisualScheduleDay(dateKey: string, force = false) {
  if (!force) {
    const cached = peekVisualScheduleDay(dateKey);
    if (cached) return cached;
  }
  await loadWindow(dateKey);
  const result = dayCache.get(dateKey);
  if (!result) throw new Error('The live scheduling context could not be resolved for this date.');
  return result;
}

export function prefetchVisualScheduleDay(dateKey: string) {
  if (peekVisualScheduleDay(dateKey)) return;
  void loadWindow(dateKey).catch(() => {
    // Prefetch is opportunistic. The foreground load will surface a real error if needed.
  });
}

export function prefetchAdjacentVisualScheduleDays(dateKey: string) {
  prefetchVisualScheduleDay(addDays(dateKey, -1));
  prefetchVisualScheduleDay(addDays(dateKey, 1));
}
