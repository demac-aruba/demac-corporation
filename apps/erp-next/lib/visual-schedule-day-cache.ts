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
  const promise = Promise.allSettled([
    loadLiveSchedulingAppointmentsFast({ startDate, endDate }),
    loadLiveOperationalCapacityState({ startDate, endDate }),
  ]).then(([appointmentsResult, stateResult]) => {
    const appointments = appointmentsResult.status === 'fulfilled' ? appointmentsResult.value : [];
    const capacityState = stateResult.status === 'fulfilled' ? stateResult.value : null;
    const loadedAt = Date.now();

    for (const dateKey of [startDate, centerDate, endDate]) {
      dayCache.set(dateKey, {
        dateKey,
        appointments: appointments.filter((appointment) => appointment.dateKey === dateKey),
        capacityState,
        loadedAt,
      });
    }

    if (appointmentsResult.status === 'rejected' && stateResult.status === 'rejected') {
      const reason = appointmentsResult.reason instanceof Error
        ? appointmentsResult.reason
        : stateResult.reason instanceof Error
          ? stateResult.reason
          : new Error('The live scheduling context could not be loaded.');
      throw reason;
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
