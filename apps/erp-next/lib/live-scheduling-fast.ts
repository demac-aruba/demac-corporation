import { listFirestoreCollection, queryFirestoreCollectionDateRange } from './firebase/firestore-rest';
import { bookingActorLabel, projectLiveSchedulingAppointments } from './live-scheduling';
import { loadLiveOperationalCapacityState } from './live-operational-capacity';
import { listOfficeAppointmentAttribution } from './office-booking-authority';
import { createSchedulingAttributionCache } from './scheduling-attribution';
import { performanceClock, recordDuration, recordPerformanceMeasurement } from './performance-telemetry';

type WorkOrder = Parameters<typeof projectLiveSchedulingAppointments>[0][number];
type Van = NonNullable<Parameters<typeof projectLiveSchedulingAppointments>[3]>[number];
export type LiveSchedulingClient = {
  id: string; name?: string; company?: string; legalName?: string; type?: string;
  phone?: string; phoneCountry?: string; whatsapp?: string; whatsappCountry?: string;
  email?: string; preferredLanguage?: string; address?: string; zone?: string;
  active?: boolean; createdAt?: string; updatedAt?: string;
};
export type LiveSchedulingProperty = {
  hasIndependentDwellings?: boolean; dwellingCount?: number; locationVersion?: number;
  id: string; clientId?: string; name?: string; type?: string; address?: string;
  addressRaw?: string; addressNormalized?: string; neighborhood?: string;
  zone?: string; operationalZone?: string; notes?: string; accessInstructions?: string;
  active?: boolean; createdAt?: string; updatedAt?: string;
};
export type LiveSchedulingReferenceData = { clients: LiveSchedulingClient[]; properties: LiveSchedulingProperty[]; vans: Van[] };
export type LiveSchedulingRange = { startDate: string; endDate: string };
const REFERENCE_CACHE_MS = 5 * 60_000;
let referenceCache: { expiresAt: number; promise: Promise<LiveSchedulingReferenceData> } | null = null;
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function recordScheduleDuration(name: string, startedAt: number, error = false) {
  recordDuration(name, 'scheduling', startedAt, { error });
}
function mergeReferenceRecords<T extends { id: string }>(current: T[], additions: T[] = []) {
  if (!additions.length) return current;
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of additions) byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item });
  return [...byId.values()];
}
export function invalidateLiveSchedulingReferenceCache() { referenceCache = null; }
/** Prime only an already committed canonical record; Firestore remains authoritative. */
export function primeLiveSchedulingReferenceCache(input: { clients?: LiveSchedulingClient[]; properties?: LiveSchedulingProperty[] }) {
  const current = referenceCache;
  if (!current) return;
  const promise = current.promise.then((references) => ({
    ...references,
    clients: mergeReferenceRecords(references.clients, input.clients),
    properties: mergeReferenceRecords(references.properties, input.properties),
  }));
  referenceCache = { expiresAt: Date.now() + REFERENCE_CACHE_MS, promise };
  promise.catch(() => { if (referenceCache?.promise === promise) referenceCache = null; });
}
export function loadLiveSchedulingReferenceData() {
  const now = Date.now();
  if (referenceCache && referenceCache.expiresAt > now) return referenceCache.promise;
  const startedAt = performanceClock();
  const promise = Promise.all([
    listFirestoreCollection<LiveSchedulingClient>('clients', 1000),
    listFirestoreCollection<LiveSchedulingProperty>('properties', 1000),
    listFirestoreCollection<Van>('vans', 250),
  ]).then(([clients, properties, vans]) => {
    recordScheduleDuration('schedule_reference_data', startedAt);
    return { clients, properties, vans };
  });
  referenceCache = { expiresAt: now + REFERENCE_CACHE_MS, promise };
  promise.catch(() => {
    recordScheduleDuration('schedule_reference_data', startedAt, true);
    if (referenceCache?.promise === promise) referenceCache = null;
  });
  return promise;
}
async function workOrdersForRange(range?: LiveSchedulingRange) {
  const startedAt = performanceClock();
  if (!range?.startDate || !range?.endDate) {
    try {
      const result = await listFirestoreCollection<WorkOrder>('workOrders', 1000);
      recordScheduleDuration('schedule_work_orders', startedAt);
      return result;
    } catch (error) { recordScheduleDuration('schedule_work_orders', startedAt, true); throw error; }
  }
  try {
    const result = await queryFirestoreCollectionDateRange<WorkOrder>({
      collectionId: 'workOrders', fieldPath: 'date', startInclusive: range.startDate, endInclusive: range.endDate, limit: 1000,
    });
    recordScheduleDuration('schedule_work_orders', startedAt);
    return result;
  } catch {
    recordPerformanceMeasurement({ name: 'schedule_work_order_fallback', module: 'scheduling', value: 1, unit: 'count', error: true });
    // Retain the current fallback for baseline parity. Optimization is a separate release.
    try {
      const all = await listFirestoreCollection<WorkOrder>('workOrders', 1000);
      const result = all.filter((order) => { const date = text(order.date); return date >= range.startDate && date <= range.endDate; });
      recordScheduleDuration('schedule_work_orders', startedAt);
      return result;
    } catch (error) { recordScheduleDuration('schedule_work_orders', startedAt, true); throw error; }
  }
}
export async function loadLiveSchedulingAppointmentsFast(range?: LiveSchedulingRange) {
  const startedAt = performanceClock();
  try {
    const [workOrders, references, operationalState] = await Promise.all([
      workOrdersForRange(range), loadLiveSchedulingReferenceData(),
      loadLiveOperationalCapacityState({ startDate: range?.startDate, endDate: range?.endDate }).catch(() => null),
    ]);
    const appointments = projectLiveSchedulingAppointments(workOrders, references.clients, references.properties, references.vans, [], operationalState);
    recordScheduleDuration('schedule_data_ready', startedAt);
    recordPerformanceMeasurement({ name: 'schedule_appointment_count', module: 'scheduling', value: appointments.length, unit: 'count' });
    return appointments;
  } catch (error) {
    recordScheduleDuration('schedule_data_ready', startedAt, true);
    recordPerformanceMeasurement({ name: 'schedule_load_error', module: 'scheduling', value: 1, unit: 'count', error: true });
    throw error;
  }
}
export function createLiveSchedulingAttributionCache() {
  return createSchedulingAttributionCache(listOfficeAppointmentAttribution, bookingActorLabel);
}
