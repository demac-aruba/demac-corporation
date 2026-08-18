import type { BrowserAppointmentRecord } from './browser-operational';
import { listFirestoreCollection } from './firebase/firestore-rest';
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
type Van = Parameters<typeof projectLiveSchedulingAppointments>[3][number];

type ReferenceData = {
  clients: Client[];
  properties: Property[];
  vans: Van[];
};

const REFERENCE_CACHE_MS = 5 * 60_000;
let referenceCache: { expiresAt: number; promise: Promise<ReferenceData> } | null = null;

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

export async function loadLiveSchedulingAppointmentsFast() {
  const [workOrders, references] = await Promise.all([
    listFirestoreCollection<WorkOrder>('workOrders', 1000),
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

export async function enrichLiveSchedulingAttribution(appointments: BrowserAppointmentRecord[]) {
  const appointmentIds = [...new Set(appointments.map((appointment) => text(appointment.id)).filter(Boolean))];
  if (!appointmentIds.length) return appointments;
  const attribution = await listOfficeAppointmentAttribution(appointmentIds);
  const byId = new Map<string, OfficeAppointmentAttribution>(attribution.map((item) => [item.appointmentId, item]));
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
