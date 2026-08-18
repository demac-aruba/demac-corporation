import type { BrowserAppointmentRecord } from './browser-operational';
import {
  listFirestoreCollection,
  queryFirestoreCollectionDateRange,
} from './firebase/firestore-rest';
import {
  bookingActorLabel,
  projectLiveSchedulingAppointments,
} from './live-scheduling';
import {
  listOfficeAppointmentAttribution,
  type OfficeAppointmentAttribution,
} from './office-booking-authority';

type WorkOrder = Parameters<typeof projectLiveSchedulingAppointments>[0][number];
type Client = Parameters<typeof projectLiveSchedulingAppointments>[1][number];
type Property = Parameters<typeof projectLiveSchedulingAppointments>[2][number];
type Van = NonNullable<Parameters<typeof projectLiveSchedulingAppointments>[3]>[number];

type ReferenceData = {
  clients: Client[];
  properties: Property[];
  vans: Van[];
};

type CachedAttribution = {
  expiresAt: number;
  value: OfficeAppointmentAttribution;
};

export type LiveSchedulingRange = {
  startDate: string;
  endDate: string;
};

const REFERENCE_CACHE_MS = 5 * 60_000;
const ATTRIBUTION_CACHE_MS = 5 * 60_000;
let referenceCache: { expiresAt: number; promise: Promise<ReferenceData> } | null = null;
const attributionCache = new Map<string, CachedAttribution>();

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function referenceData() {
  const now = Date.now();
  if (referenceCache && referenceCache.expiresAt > now) return referenceCache.promise;
  const promise = Promise.all([
    listFirestoreCollection<Client>('clients', 1000),
    listFirestoreCollection<Property>('properties', 1000),
    listFirestoreCollection<Van>('vans', 250),
  ]).then(([clients, properties, vans]) => ({ clients, properties, vans }));
  referenceCache = { expiresAt: now + REFERENCE_CACHE_MS, promise };
  promise.catch(() => {
    if (referenceCache?.promise === promise) referenceCache = null;
  });
  return promise;
}

async function workOrdersForRange(range?: LiveSchedulingRange) {
  if (!range?.startDate || !range?.endDate) return listFirestoreCollection<WorkOrder>('workOrders', 1000);
  try {
    return await queryFirestoreCollectionDateRange<WorkOrder>({
      collectionId: 'workOrders',
      fieldPath: 'date',
      startInclusive: range.startDate,
      endInclusive: range.endDate,
      limit: 1000,
    });
  } catch {
    const all = await listFirestoreCollection<WorkOrder>('workOrders', 1000);
    return all.filter((order) => {
      const date = text(order.date);
      return date >= range.startDate && date <= range.endDate;
    });
  }
}

export async function loadLiveSchedulingAppointmentsFast(range?: LiveSchedulingRange) {
  const [workOrders, references] = await Promise.all([
    workOrdersForRange(range),
    referenceData(),
  ]);
  return projectLiveSchedulingAppointments(
    workOrders,
    references.clients,
    references.properties,
    references.vans,
    [],
  );
}

async function attributionFor(appointmentIds: string[]) {
  const now = Date.now();
  const resolved = new Map<string, OfficeAppointmentAttribution>();
  const missing: string[] = [];
  for (const id of appointmentIds) {
    const cached = attributionCache.get(id);
    if (cached && cached.expiresAt > now) resolved.set(id, cached.value);
    else missing.push(id);
  }

  if (missing.length) {
    const loaded = await listOfficeAppointmentAttribution(missing);
    for (const item of loaded) {
      resolved.set(item.appointmentId, item);
      attributionCache.set(item.appointmentId, { expiresAt: now + ATTRIBUTION_CACHE_MS, value: item });
    }
  }
  return resolved;
}

export async function enrichLiveSchedulingAttribution(appointments: BrowserAppointmentRecord[]) {
  const appointmentIds = [...new Set(appointments.map((appointment) => text(appointment.id)).filter(Boolean))];
  if (!appointmentIds.length) return appointments;
  const byId = await attributionFor(appointmentIds);
  return appointments.map((appointment) => {
    const authorityAppointment = byId.get(appointment.id);
    if (!authorityAppointment) return appointment;
    const actorLabel = bookingActorLabel(authorityAppointment);
    return {
      ...appointment,
      bookedById: text(authorityAppointment.createdBy) || undefined,
      bookedByName: actorLabel || undefined,
      bookedBySource: text(authorityAppointment.source) || undefined,
      createdAt: text(authorityAppointment.createdAtIso) || appointment.createdAt,
      updatedAt: text(authorityAppointment.updatedAtIso) || appointment.updatedAt,
    };
  });
}
